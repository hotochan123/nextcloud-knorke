/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SceneManager (SPEC-M0 §6.3, v2 in SPEC-M1 §6.3): the facade BoardSession
 * [C] talks to. It owns the Konva renderer, the DOM overlay (cursors, chips,
 * text editor, the hold ring of the touch marquee), the gesture and input
 * controllers, the transformer and the ONE animation-frame loop.
 *
 * Fixed semantics (R2):
 * - camera: getCamera() and stats().camera are the CONFIRMED camera (unchanged
 *   during a CSS gesture); stats().liveCamera is the gesture camera. onCamera
 *   fires with the live camera at most 10 × per second, and once at the end of
 *   a gesture with the new confirmed camera.
 * - (M1) onUserCamera() fires once per USER camera change: a wheel or touch
 *   gesture (its first frame), a hand/space/middle-button pan (its first
 *   move), the zoom keys +/−, Shift+1/0/2 and a Tab selection that pans the
 *   item into view, and (R16, from WP-S3 on) the small-target zoom of mode
 *   vote; never for setCamera, fit or zoomBy of this facade and never for
 *   followTo.
 * - (stage 3, signatures frozen in phase 0 and step 3.1b, behaviour WP-S3,
 *   SPEC-M1 §6.3) setVoteState(state) checks a SceneVoteState strictly,
 *   values included (TypeError on a deviation, the old state stays) and
 *   keeps a copy; null clears it. The renderer paints from it (own badges in
 *   state.color with digits in contrastTextOn, totals, with markVotable the
 *   empty rings and the scope outline); stats().voteState = null without
 *   one, else {scope, markVotable, rings, badges, totals, outline} counted
 *   from what the last frame DREW. Mode vote: a click (mouse) or tap
 *   (finger, pen) on an item asks votable(id) === true → vote {id, rect:
 *   itemScreenRect} or voteMiss {id}; a touch/pen tap on a votable item
 *   smaller than SMALL_TARGET_PX zooms instead (onUserCamera); empty canvas
 *   gives nothing. followTo(cam, ms) → Promise<boolean> glides over the CSS
 *   path without onActivity gesture and without onUserCamera (onCamera as
 *   for a gesture), semantics (1)–(7) of §6.3 "Folgen" at followTo;
 *   stopFollow() ends a glide (a no-op without one). getViewport() = the
 *   world rectangle of the confirmed camera; cameraForRect(rect, padPx) = a
 *   camera without the 100 % limit of fit(). onActivity kind 'press' in
 *   modes vote and view describes the canvas: on with the first pointer
 *   down, off with the last one up (and at a switch to edit).
 * - (stage 4, step 4.2, SPEC-M1 §9.5 WP-S4 (R16)) context menu: onIntent
 *   ({type:'contextMenu', id, at:[x, y]}), at in container px, mode edit
 *   only. It fires for the canvas's contextmenu event of a mouse or pen
 *   (right click, macOS Ctrl+click, barrel button, press-and-hold) and for
 *   the ContextMenu key or Shift+F10 with the canvas focus; the rules
 *   (selection first, handles, empty canvas, keyboard anchor, what drops an
 *   unmoved press) are in the Intent typedef and in InputController.js. It
 *   never fires in modes vote and view (preventDefault as before), for a
 *   finger (no long press on touch), during a moved press or a user camera
 *   gesture, nor while a text editor is open or for an overlay control;
 *   these two keep the browser's own menu (no preventDefault). A
 *   right-button pointerdown starts no pan, marquee or drag.
 * - releasing a drag calls onDragPreview([]) → onIntent({type:'move', …})
 *   (isActive(id) still true, the model still at the dragged position) →
 *   onActivity({kind:'drag', active:false}); a transform releases the same
 *   way: onDragPreview([]) → onIntent({type:'transform', …}) (isActive still
 *   true) → onActivity({kind:'transform', active:false}). Esc ends either
 *   without an intent (model back).
 * - (M2, SPEC-M1 §1.2 (R12)) a drag snaps: the union box of the dragged
 *   boxes (connectors not counted, taken at the start) snaps per axis with
 *   its left/centre/right and top/middle/bottom lines to the same lines of
 *   the items in view at the start (src/model/snap.js; not the dragged items,
 *   their descendants and attached connectors, no connector at all), within
 *   OBJECT_SNAP_PX screen px of the live scale; with the same threshold a
 *   gap to a neighbour in the row or column of the box snaps to the gap of
 *   two other items there (equal gaps, snapMove; the smaller correction per
 *   axis wins against a line). The model, the preview rows (onDragPreview)
 *   and the move intent carry the snapped shift; the guides and the gap
 *   markers go to the renderer's uiGroup while snapped (stats().snapGuides,
 *   stats().gapMarkers) and leave at the end. Ctrl/⌘ held (host.moveDrag
 *   mods.ctrl) drags free.
 * - (M2, R12) a resize snaps too: a transform with a resize handle collects
 *   the candidates once at its start (the items in the live view; one item:
 *   without itself, so the children of a resized frame are targets; several:
 *   without everything that moves) and every step snaps the moving edges of
 *   the transformer frame to them (TransformController.step snap, the same
 *   threshold); the guides go to the renderer while snapped
 *   (stats().snapGuides) and leave before the release's onDragPreview([]),
 *   at Esc and when the transform is dropped. No gap markers. Ctrl/⌘ held
 *   (host.moveTransform mods.ctrl) resizes free.
 * - (M2, R12) background grid: option grid (default false; only true turns it
 *   on), setGrid(on) / getGrid(); the renderer paints it below everything
 *   (renderer.setGrid, from mount() on), in every mode. The key G with the
 *   canvas focus (InputController) toggles it through host.toggleGrid and
 *   reports onGrid(on) (like onTool: only for the scene's own switch, never
 *   for setGrid). While it is on, a drag puts the left/top edge of its box
 *   on the GRID_SIZE grid and a resize its moving edges (snapMove,
 *   TransformController.step snap.grid), on every axis where no item snaps
 *   (items keep the priority); Ctrl/⌘ turns both off. Option gridSnap
 *   (default true; anything but true turns it off), setGridSnap(on) /
 *   getGridSnap(): the grid snapping acts only while the grid is shown and
 *   gridSnap is on (no renderer call, no callback; BoardSession switches it
 *   from the board menu). A switch of either during a drag or resize acts
 *   from the next step. stats().grid, stats().gridSnap; stats().draws.grid.
 * - isActive(id): dragged items with descendants, transformed items with
 *   descendants, every connector attached to them (and the selected
 *   connectors that follow a drag or transform), the connector whose end is
 *   being dragged (retarget), the item in the text editor.
 * - connectors (round 1b, SPEC-M1 §6.3): tool connector (L) or a "+" handle
 *   of one selected note/shape/text drags a new connector (ConnectController:
 *   snapping to targets and anchors, Ctrl/⌘ = free, Esc cancels); the end
 *   handles of one selected connector drag that end (retarget, previewed in
 *   the model with setEndsLocal). Both report onActivity({kind:'connect'})
 *   and release like a drag: preview cleared → onIntent (isActive still true
 *   for the re-targeted connector) → onActivity(active false). A drag takes
 *   the connectors attached to the dragged items into the activeGroup (they
 *   are re-routed, the static layer is not redrawn: gate G12); a selected
 *   connector moves with the drag only when it has no bound end outside the
 *   dragged items (its free ends shift; bound ends follow their targets).
 *   Remote drag previews re-route attached connectors over the model's box
 *   resolver. A double click on a connector edits its label (kind label).
 * - the text editor has no cancel: blur, Esc, a click beside it and
 *   Ctrl/⌘+Enter end it with a commit (final: true); Esc in the editor keeps
 *   the selection; an editor with a notice discards on close. (M1) Tab in a
 *   note editor ends it with next:'right' (series entry); a text intent of a
 *   `text` item carries h, its height measured for the new text (rule 13).
 *   An editor ended by a key gives the focus back to the canvas.
 * - (R4) flushEditor() reports the open editor's not yet committed text at
 *   once as an intermediate intent (final:false) and leaves the editor open;
 *   [C] calls it first on pagehide, beforeunload, visibilitychange (hidden)
 *   and before leaving the board, because none of these fires a blur.
 * - lease lock: opening (double click, Enter, or openTextEditor without
 *   `text`) an item whose text another participant holds (RemoteSample
 *   editing == id && editingHolder) opens no editor; the chip offers "Take
 *   over" for 5 s, and a click opens the editor with onEditing(id, true).
 * - openTextEditor while the editor is closing (called from inside its final
 *   intent, e.g. the series entry) opens right after the close.
 * - the loop runs only when there is work (camera, gesture, drag, transform,
 *   non-empty presence, pending draws); presenceChanged() wakes it.
 * - keys (SPEC-M1 §6.3, §6.10): single keys only with the canvas focus (the
 *   container; mount() gives it tabindex 0 when the host did not);
 *   focusCanvas() puts the focus there.
 * - modes (SPEC-M1 §6.3, stage 2): setMode('edit'|'vote'|'view', {settle});
 *   vote is view plus voting (stage 3, above). Leaving edit
 *   without settle works like Esc (role lost, frozen): a drag, transform or
 *   connect drag ends without an intent, an open editor stays open (the
 *   session decides about it). (R13) With settle (a voting session starts
 *   while editing) the scene first ends an open editor with its final
 *   commit, then finishes a drag, transform or connect drag like a release
 *   (onDragPreview([]) → intent → onActivity({active: false})), and only
 *   then switches. setViewOnly(v) = setMode(v ? 'view' : 'edit').
 * - LOD 2 (SPEC-M1 §6.3, R13 (c)): while the renderer draws LOD 2, a click
 *   (hitTest with accept) and the marquee pass over connectors (Ctrl+A and
 *   Tab still select them); a selected connector shows only its halo, no end
 *   handles and no "+" handles; frames hit as at LOD 0/1 (title band and
 *   border, not the inside) and (R14-13) also in their title as the LOD-2
 *   painting drew it (renderer.coarseTitleAt, host.coarseTitleAt).
 * - (M2, SPEC-M1 §1.2 "(R20) Sperren") locked items (model/locks.js): a
 *   press selects them, a move does nothing (InputController); a drag and
 *   the arrow keys move only the unlocked top-level items of the
 *   selection; marquee and Ctrl/⌘+A skip locked items, Tab reaches them.
 *   While a top-level selected item is locked there are no transformer
 *   handles (size, rotation); exactly one locked note, shape or text keeps
 *   its four "+" handles (Connect), a locked connector shows no end
 *   handles; the outline of the selection stays; the handles follow a lock
 *   change at once. A user editor (double click, Enter, openTextEditor
 *   without text and notice) never opens on a locked item; the rescue
 *   editor (with a notice) still does. The renderer paints a lock symbol
 *   on every locked item in view, at every LOD (uiGroup, nodes/locks.js);
 *   stats().locks counts the symbols of the last painting.
 * - (M2, SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js) groups: the
 *   selection rules of a press are InputController's. A drag and the arrow
 *   keys move only movableIds of the top-level selection (no locked item,
 *   no member of a group with a locked member; nothing left: no drag). Tab
 *   selects like a click (the members, the reached item last) and skips the
 *   other members of the current item's fully selected group. The drop
 *   target of a dragged group (the lead belongs to a group that is fully
 *   dragged) lies under the centre of the members' union; a member of a
 *   group that is not fully dragged keeps its parent and shows none. A
 *   fully selected group is a multi-selection for the transformer (four
 *   corners, uniform scaling, no rotation); with more than one top-level
 *   item there are no transformer handles while one belongs to a group
 *   with a locked member; exactly one group drops the dashed frame of the
 *   multi-selection (the corners stay). Every fully selected group gets
 *   ONE solid outline (the renderer's setSelection groups, the union of its
 *   members' rotated boxes) instead of its members' own;
 *   stats().groupOutlines counts them. Outlines and handles follow a
 *   change of group at once (update). Selections of others stay per item.
 * - (R38, SPEC-M1 §6.3 "Halten, dann Ziehen") touch marquee: a first
 *   finger held still on empty canvas for LONG_PRESS_MS with the select tool
 *   (GestureController longPress → InputController.claimLongPress) gets the
 *   hold signal: a ring under the finger (a DOM element in the overlay,
 *   [data-knorke-hold-ring], aria-hidden, HOLD_RING_PX wide; look, fade-in,
 *   forced colors and reduced motion in knorke.css) and one vibration of
 *   LONG_PRESS_VIBRATE_MS where navigator.vibrate exists. A drag beyond
 *   TAP_SLOP_PX then draws the marquee from the pointerdown point and
 *   selects live like a mouse marquee without Shift; no camera moves. The
 *   ring stays at the start point until the press ends (release, Esc,
 *   pointercancel, second finger, mode switch, destroy). stats().holdRing.
 *   The scene sets no timer of its own (the GestureController's default
 *   setTimeout).
 *
 * Neither the model nor any Konva object is ever handed to a reactive system;
 * this module does not import Vue.
 */
import { labelBox } from '../model/connectors.js'
import { expandGroups, groupOf, heldGroup, isOneGroup, movableIds, wholeGroups } from '../model/groups.js'
import { isLocked } from '../model/locks.js'
import { getPath } from '../model/paths.js'
import { ENUMS, canBeChildOf, fieldValue, isBindable, textPathOf, typeInfo } from '../model/registry.js'
import { buildSnapIndex, snapMove } from '../model/snap.js'
import { noteFontSize } from '../model/text.js'
import { TOOL_IDS } from '../model/tools.js'
import { ANCHORS, getCursor, handlesFor, selectionFrame } from '../model/transform.js'
import {
	BOARD_BACKGROUND, CONNECTOR_LABEL_FONT_SIZE, CONNECTOR_LABEL_PAD, CONNECTOR_PLUS_OFFSET_PX, FRAME_TITLE_BAND,
	FRAME_TITLE_SIZE, GRID_SIZE, HANDLE_PX, HANDLE_TOUCH_PX, HOLD_RING_PX, LONG_PRESS_VIBRATE_MS, MAX_SCALE, MIN_SCALE,
	OBJECT_SNAP_PX, SNAP_PX, STICKY_PADDING,
} from '../model/tokens.js'
import { Camera, clampScale, viewRectOf } from './Camera.js'
import { ConnectController, plusHandles, snapAt } from './ConnectController.js'
import { CursorLayer, setStyles } from './CursorLayer.js'
import { GestureController, TAP_SLOP_PX } from './GestureController.js'
import { DRAG_THRESHOLD_PX, InputController } from './InputController.js'
import { KonvaRenderer } from './KonvaRenderer.js'
import { shapeTextBox } from './nodes/shape.js'
import { Selection, topLevel } from './Selection.js'
import { TextEditor } from './TextEditor.js'
import { TransformController } from './TransformController.js'

/**
 * @typedef {{x:number, y:number, scale:number}} Camera
 * @typedef {{x:number, y:number}} Point
 * @typedef {'select'|'hand'|'sticky'|'shape'|'text'|'connector'|'frame'} Tool
 * @typedef {{kind?:string, route?:string, endCap?:string}} ToolOptions
 * @typedef {'edit'|'vote'|'view'} SceneMode
 * @typedef {{x:number, y:number, w:number, h:number, r:number}} Box   absolute, world
 * @typedef {{key:string, pid:string, name:string, color:string, guest:boolean,
 *            cursor:([number,number]|null), selection:string[], drag:Array<[string,number,number]>,
 *            editing:(string|null), editingHolder:boolean,
 *            view:([number,number,number,number]|null)}} RemoteSample
 *   view (stage 3): the participant's viewport [x, y, w, h] in world units (presence v, §6.4); the scene does not read it
 * @typedef {{votable:(id:string) => boolean, scope:(string|null),
 *            badges:Map<string, {mine:number, total:(number|null)}>,
 *            markVotable:boolean, color:string}} SceneVoteState
 *   (stage 3, SPEC-M1 §6.3, values R16; setVoteState throws a TypeError on any deviation)
 *   votable: may this item get votes, asked with an item id ([C] adapts: (id) => voteState.votable(model.get(id)));
 *   scope: frame ULID of the voting area or null (whole board);
 *   badges: per item id (string) my votes (mine, an integer >= 0) and the total (an integer >= 0, or null =
 *     show no total, e.g. while results are hidden; never undefined);
 *   markVotable: empty rings on visible votable items without an own vote and a 2-px outline around the scope frame;
 *   color: #rrggbb of the own pid ([C]: colorFor(me.pid), src/sync/presence.js; hex digits in either case, like
 *     contrastTextOn): own badges are drawn in it, their digits in contrastTextOn(color);
 *   keys beyond these are ignored
 * @typedef {{item:string}|{item:string, ax:number, ay:number}|{x:number, y:number}} Endpoint
 * @typedef {(
 *   {type:'create', t:string, at:{x:number,y:number}, rect:({x:number,y:number,w:number,h:number}|null),
 *    data?:object, style?:object} |
 *   {type:'move', ids:string[], dx:number, dy:number, origin:Map<string,{x:number,y:number,parent:(string|null)}>,
 *    nudge?:boolean} |
 *   {type:'transform', ids:string[], before:Map<string, Box & {parent:(string|null), fontSize?:number}>,
 *    after:Map<string, Box & {fontSize?:number}>, keep:boolean} |
 *   {type:'connect', start:Endpoint, end:Endpoint, route:string, endCap:string} |
 *   {type:'retarget', id:string, which:'start'|'end', value:Endpoint, before:Endpoint} |
 *   {type:'delete', ids:string[]} |
 *   {type:'text', id:string, path:string, value:string, before:string, final:boolean, h?:number, next?:'right'} |
 *   {type:'reorder', ids:string[], where:'front'|'back'} |
 *   {type:'copy'} | {type:'cut'} | {type:'duplicate'} | {type:'pasteKey', inPlace:boolean} |
 *   {type:'vote', id:string, rect:{x:number, y:number, w:number, h:number}} |
 *   {type:'voteMiss', id:(string|null)} |
 *   {type:'contextMenu', id:(string|null), at:[number, number]} |
 *   {type:'undo'} | {type:'redo'}
 * )} Intent
 *   connect/retarget: round 1b. move.nudge: arrow keys (one undo step per key series, the session merges).
 *   vote/voteMiss (stage 3, mode vote only): a click or tap on an item for which
 *   SceneVoteState.votable(id) holds, resp. a hit on an item that is not votable (the shell explains why);
 *   a click into empty space gives neither. (R16) vote.rect = itemScreenRect(id) at the time of the click
 *   or tap: container px, confirmed camera, axis-aligned (the shell anchors its vote stepper there).
 *   A touch/pen tap on a votable item whose itemScreenRect has min(w, h) < 44 px zooms instead (onUserCamera,
 *   no vote) as long as the zoom can still enlarge it; a mouse click always votes; an item that is not
 *   votable always gives voteMiss, never a zoom.
 *   contextMenu (stage 4, step 4.2; SPEC-M1 §9.5 WP-S4): mode edit only; open a context menu. id = the item
 *   it is about (string) or null (empty canvas); at = [x, y] in container px (the space of vote.rect and
 *   itemScreenRect; confirmed camera, a running follow glide or wheel gesture ends first). From the canvas's
 *   contextmenu event (right click, macOS Ctrl+click, pen barrel button or press-and-hold): at = the event
 *   point; an item outside the selection is selected first (onSelection before onIntent), an item inside
 *   keeps the selection, a transformer handle keeps it too (id = the hit item when selected, else the last
 *   selected item), empty canvas clears it (id null). From the ContextMenu key or Shift+F10 with the canvas
 *   focus: id = the last selected item or null, at = the midpoint of the selection's screen box clamped into
 *   the container, the container centre without a selection. Never in modes vote and view, never for a
 *   finger (long press), never while a text editor is open or on an overlay control (no preventDefault:
 *   the browser's menu stays), never during a moved press (drag, transform, connect, marquee, create
 *   drag), a touch gesture, a mouse/pen pan or a finger below the tap threshold; an unmoved press (macOS
 *   Ctrl+click) is dropped first (no drag, no marquee, nothing created; the tool stays).
 * @typedef {{onIntent(i:Intent):void, onSelection(ids:string[]):void, onCamera(c:Camera):void,
 *            onUserCamera():void, onPointer(w:([number,number]|null)):void,
 *            onActivity(a:{kind:'drag'|'edit'|'gesture'|'transform'|'connect'|'press', active:boolean, ids:string[]}):void,
 *            onDragPreview(p:Array<[string,number,number]>):void,
 *            onEditing(id:(string|null), takeover:boolean):void, onTool(t:Tool):void,
 *            onGrid(on:boolean):void}} SceneCallbacks
 *   onGrid (M2, R12): the scene itself switched the background grid (the key G), with the new state; never
 *   for setGrid of this facade (as onTool for the tool keys).
 *   onActivity kind 'press' (stage 3; §6.3, §6.5.6: the session holds follow jumps
 *   back while it is active): modes vote and view only, any pointer type, ids always []. (R16) It describes
 *   the canvas, not a pointer: active true on the first pointerdown on the canvas while no other pointer is
 *   down, active false only when the last pointer down reports pointerup/pointercancel (a second finger
 *   neither starts a second press nor ends the first). A switch to mode edit ends an open press with
 *   active false. Not reported in mode edit (drag/gesture cover it there).
 */

/** Tool ids (SPEC-M1 §6.2 TOOLS, the table lives in src/model/tools.js). */
export const TOOLS = TOOL_IDS
/** onCamera at most every CAMERA_EMIT_MS. */
const CAMERA_EMIT_MS = 100
/** "Take over" stays on the chip this long after a blocked double click. */
export const TAKE_OVER_MS = 5000
/** openTextEditor for an item that is not in the model yet waits this long for it. */
const PENDING_OPEN_MS = 2000
/** Zoom step of the +/− keys. */
const KEY_ZOOM_STEP = 1.25
/** Screen margin of Shift+2 (zoom to the selection). */
const SELECTION_ZOOM_PAD_PX = 40
const DEFAULT_LIMITS = Object.freeze({ maxText: 6000, maxTitle: 200, maxLabel: 200 })
const CALLBACKS = ['onIntent', 'onSelection', 'onCamera', 'onUserCamera', 'onPointer', 'onActivity', 'onDragPreview', 'onEditing', 'onTool', 'onGrid']
/** Default tool options (§6.2 TOOLS options), validated against the registry enums. */
const TOOL_OPTION_DEFAULTS = Object.freeze({ shape: Object.freeze({ kind: 'rect' }), connector: Object.freeze({ route: 'straight', endCap: 'arrow' }) })
const TOOL_OPTION_ENUMS = Object.freeze({ kind: ENUMS.shapeKinds, route: ENUMS.routes, endCap: ENUMS.caps })
/** Tools that create items (crosshair cursor). */
const CREATE_TOOLS = new Set(['sticky', 'shape', 'text', 'connector', 'frame'])
/** Scene modes (SPEC-M1 §6.3 SceneMode). */
export const MODES = Object.freeze(['edit', 'vote', 'view'])

/**
 * Re-throws an error from a callback outside the scene's own stack, so the
 * scene state stays consistent and the error still surfaces.
 *
 * @param {unknown} err error
 */
function reportAsync(err) {
	if (typeof reportError === 'function') {
		reportError(err)
	} else {
		setTimeout(() => { throw err }, 0)
	}
}

/**
 * The short vibration of the hold signal (R38), only where the browser has
 * navigator.vibrate (not Safari). Its answer and any error are ignored:
 * Chrome refuses before the first user activation of the page, and a
 * switched-off vibration is the system's choice; the ring still shows.
 *
 * @param {number} ms duration
 */
function vibrate(ms) {
	const nav = globalThis.navigator
	if (typeof nav?.vibrate !== 'function') return
	try {
		nav.vibrate(ms)
	} catch {
		// refused or not allowed: the ring alone is the signal
	}
}

/** @param {number} v value @return {number} rounded to 0.01 */
const r2 = (v) => Math.round(v * 100) / 100

/**
 * @param {unknown} cam value
 * @return {boolean} a camera {x, y, scale} with finite numbers and scale > 0
 */
function isCamera(cam) {
	return cam !== null && typeof cam === 'object' && Number.isFinite(cam.x) && Number.isFinite(cam.y) &&
		Number.isFinite(cam.scale) && cam.scale > 0
}

/** followTo (§6.3 "Folgen" (3)): a target whose corner lies closer than this to the confirmed one (screen px) … */
const FOLLOW_SAME_PX = 0.5
/** … with a scale within this share of the confirmed scale is the same camera (nothing to draw). */
const FOLLOW_SAME_SCALE = 0.001

/**
 * @param {Camera} c0 confirmed camera
 * @param {Camera} c1 target camera (scale already clamped)
 * @return {boolean} c1 shows the same picture as c0 (§6.3 "Folgen" (3))
 */
function sameCamera(c0, c1) {
	return Math.hypot(c1.x - c0.x, c1.y - c0.y) * c0.scale < FOLLOW_SAME_PX &&
		Math.abs(c1.scale - c0.scale) <= c0.scale * FOLLOW_SAME_SCALE
}

/**
 * The camera of a follow glide at u ∈ [0, 1] from a to b (§6.3 "Folgen"):
 * the viewport centre moves linearly, the scale geometrically (no swing of
 * a corner while zooming); constant speed, so a glide that replaces the
 * previous one (the next presence card) continues smoothly.
 *
 * @param {Camera} a start camera
 * @param {Camera} b target camera
 * @param {number} u progress
 * @param {number} vw viewport width (px)
 * @param {number} vh viewport height (px)
 * @return {Camera}
 */
export function glideCamera(a, b, u, vw, vh) {
	if (u >= 1) return { x: b.x, y: b.y, scale: b.scale }
	if (u <= 0) return { x: a.x, y: a.y, scale: a.scale }
	const s = a.scale * Math.pow(b.scale / a.scale, u)
	const ax = a.x + vw / (2 * a.scale)
	const ay = a.y + vh / (2 * a.scale)
	const bx = b.x + vw / (2 * b.scale)
	const by = b.y + vh / (2 * b.scale)
	return { x: ax + (bx - ax) * u - vw / (2 * s), y: ay + (by - ay) * u - vh / (2 * s), scale: s }
}

/** stats().voteState counters while nothing is drawn. */
const VOTE_DRAWN_NONE = Object.freeze({ rings: 0, badges: 0, totals: 0, outline: null })
/** Mode vote: a touch/pen tap on a votable item smaller than this (min(w, h) of itemScreenRect, px) zooms instead of voting. */
export const SMALL_TARGET_PX = 44
/** … the zoom gives the item's shorter side this size (px), … */
export const SMALL_TARGET_GOAL_PX = 88
/** … at most so far that the item fits with this margin (px), … */
const SMALL_TARGET_PAD_PX = 16
/** … and only when it enlarges the item by more than this share (else the tap votes: no endless zoom). */
const SMALL_TARGET_MIN_GAIN = 0.01
/** SceneVoteState.color: #rrggbb (hex digits in either case, as contrastTextOn reads them). */
const VOTE_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** @param {unknown} v value @return {boolean} an integer >= 0 (a vote count) */
const isCount = (v) => Number.isInteger(v) && v >= 0

/**
 * Checks a SceneVoteState against its typedef and value rules (SPEC-M1 §6.3,
 * R16) and returns a frozen copy: votable kept as given, badges copied entry
 * by entry. Keys beyond the typedef are ignored. Values: votable a function,
 * scope a string or null, badges a Map from item ids (strings) to {mine: an
 * integer >= 0, total: an integer >= 0 or null (never undefined)},
 * markVotable a boolean, color #rrggbb.
 *
 * @param {unknown} state value handed to setVoteState (not null)
 * @return {Readonly<SceneVoteState>} copy
 * @throws {TypeError} when state deviates from SceneVoteState
 */
function checkVoteState(state) {
	const bad = (what) => new TypeError(`setVoteState: ${what} (SceneVoteState, SPEC-M1 §6.3)`)
	if (state === null || typeof state !== 'object' || Array.isArray(state)) throw bad('state must be an object or null')
	const { votable, scope, badges, markVotable, color } = state
	if (typeof votable !== 'function') throw bad('votable must be a function (id) => boolean')
	if (scope !== null && typeof scope !== 'string') throw bad('scope must be a frame id (string) or null')
	if (!(badges instanceof Map)) throw bad('badges must be a Map')
	if (typeof markVotable !== 'boolean') throw bad('markVotable must be a boolean')
	if (typeof color !== 'string' || !VOTE_COLOR_RE.test(color)) throw bad('color must be #rrggbb')
	const copy = new Map()
	for (const [id, b] of badges) {
		if (typeof id !== 'string') throw bad('badge keys must be item ids (strings)')
		if (b === null || typeof b !== 'object') throw bad(`the badge of ${id} must be {mine, total}`)
		if (!isCount(b.mine)) throw bad(`the badge of ${id}: mine must be an integer >= 0`)
		if (b.total !== null && !isCount(b.total)) throw bad(`the badge of ${id}: total must be an integer >= 0 or null`)
		copy.set(id, Object.freeze({ mine: b.mine, total: b.total }))
	}
	return Object.freeze({ votable, scope, badges: copy, markVotable, color })
}

/** Smallest width of the label editor (world units): about six average glyphs (4 em) and the padding. */
const LABEL_EDITOR_MIN_W = 4 * CONNECTOR_LABEL_FONT_SIZE + 2 * CONNECTOR_LABEL_PAD
/** Hit tolerance of the connect tool (screen px; touch and pen: the wider one). */
const CONNECT_TOL_PX = 4
const CONNECT_TOL_TOUCH_PX = 12

/**
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {boolean} a routed item (connector)
 */
function isRouted(model, id) {
	return typeInfo(model.get(id)?.t).hit === 'line'
}

/**
 * The items a drag or nudge moves (SPEC-M1 §6.5.2 moveItems v2): the
 * top-level boxes, plus the selected connectors whose bound ends all lie
 * on moved items (descendants included); a connector bound to anything
 * outside stays (only its end handles move it).
 *
 * @param {object} model SceneModel
 * @param {string[]} top top-level selection
 * @return {{top:string[], all:Set<string>}} moved ids and every id that moves (descendants, the connectors among top)
 */
function movedItems(model, top) {
	const boxes = top.filter((id) => !isRouted(model, id))
	const all = new Set(boxes)
	for (const id of boxes) {
		for (const d of model.descendantsOf(id)) all.add(d)
	}
	const conns = top.filter((id) => isRouted(model, id)).filter((id) => {
		const it = model.get(id)
		return ['start', 'end'].every((w) => {
			const item = fieldValue(it, 'data.' + w)?.item
			return typeof item !== 'string' || all.has(item)
		})
	})
	for (const c of conns) all.add(c)
	return { top: [...boxes, ...conns], all }
}

/**
 * Snap candidates of a drag (M2, R12): the axis-aligned, unpadded boxes of
 * the items in a world rectangle, without the dragged ids and without any
 * connector.
 *
 * @param {object} model SceneModel
 * @param {{minX:number, minY:number, maxX:number, maxY:number}} r world rectangle (the view at the start)
 * @param {Set<string>} exclude dragged items, their descendants and attached connectors
 * @return {import('../model/snap.js').SnapIndex}
 */
function snapIndexOf(model, r, exclude) {
	const boxes = []
	for (const e of model.query(r.minX, r.minY, r.maxX, r.maxY)) {
		if (exclude.has(e.id) || isRouted(model, e.id)) continue
		const b = model.boundsOf([e.id])
		if (b) boxes.push({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h })
	}
	return buildSnapIndex(boxes)
}

/**
 * @param {Array<{axis:string, at:number, from:number, to:number}>} a guides (or gap markers)
 * @param {Array<{axis:string, at:number, from:number, to:number}>} b guides (or gap markers)
 * @return {boolean} the same guides in the same order
 */
function sameGuides(a, b) {
	return a.length === b.length &&
		a.every((g, i) => g.axis === b[i].axis && g.at === b[i].at && g.from === b[i].from && g.to === b[i].to)
}

/**
 * Tab order key of an item (SPEC-M1 §6.3): frames first, then content; per
 * group by y, then x of the box centre on a 10-unit grid, then stacking order.
 *
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {[number, number, number]} [group, row, column]
 */
function tabKey(model, id) {
	// connectors with their route box; one that has no route yet goes last
	const b = model.boundsOf([id])
	if (!b) return [1, Infinity, Infinity]
	const cx = b.x + b.w / 2
	const cy = b.y + b.h / 2
	return [typeInfo(model.get(id).t).container ? 0 : 1, Math.round(cy / 10), Math.round(cx / 10)]
}

export class SceneManager {
	#container
	#model
	#cb
	/** @type {SceneMode} */
	#mode = 'edit'
	/** mode !== 'edit' (vote is view-only until stage 3) */
	#viewOnly
	#limits
	#renderer
	#camera = new Camera()
	#selection = new Selection()
	#tool = 'select'
	#toolOptions = { shape: { ...TOOL_OPTION_DEFAULTS.shape }, connector: { ...TOOL_OPTION_DEFAULTS.connector } }
	#space = false
	#mounted = false
	#destroyed = false
	#raf = 0
	#size = { w: 0, h: 0 }
	#resizePending = false
	#resizeObserver = null
	#overlay = null
	#cursors = null
	#editor = null
	#gestures = null
	#input = null
	#pendingCam = false
	#live = null
	#liveDirty = false
	#lastCameraMs = 0
	#camLast = -Infinity
	#camPending = null
	#drag = null
	#xf = null
	#xfTarget = null
	/** snapping of a running transform (R12): {index (null at 'rot'), guides shown, gaps (always [])}, else null */
	#xfSnap = null
	#sampler = null
	#samplesActive = false
	#presenceDirty = false
	#lastSamples = []
	#remoteSel = []
	#takeOver = null
	#pendingOpen = null
	#handlesDirty = false
	/** handles shown now: {list:[{name,x,y}] world, frame, scale} or null */
	#handleState = null
	#hoverHandle = null
	/** a user gesture/pan reported onUserCamera already */
	#userCamSent = false
	/** measured text height of the open text editor: [value, h] */
	#editorMeasure = null
	/** connect / retarget drag ([S]-internal) */
	#cc = null
	/** pending pointer step of the connect drag: {w, mods} */
	#ccTarget = null
	/** the handles were placed for LOD 2 (#syncHandles) */
	#handleCoarse = false
	/** connectors attached to the transformed items (isActive, activeGroup) */
	#xfLinks = new Set()
	/** top-level ids of the remote drag previews shown now */
	#previewIds = new Set()
	/** voting state (setVoteState): a frozen, checked copy, or null @type {Readonly<SceneVoteState>|null} */
	#vote = null
	/** votable(id) === true per item id for the badge painting; cleared with every vote state and model change */
	#votableCache = new Map()
	/** an error of votable() was reported for the current vote state */
	#votableErr = false
	/** follow glide (followTo): {from, to, t0, ms, resolve} or null; #live is its camera meanwhile */
	#glide = null
	/** 'press' (modes vote/view): pointers down on the canvas, and whether press is reported active */
	#press = { ids: new Set(), active: false }
	/** listeners of the scene itself: [target, type, fn] */
	#own = []
	/** background grid shown, and drags and resizes snap to it while #gridSnap (M2, R12) */
	#grid = false
	/** drags and resizes snap to the shown grid (M2, R12; off: the grid is only shown) */
	#gridSnap = true
	/** hold signal of the touch marquee (R38): {el, x, y} (the ring in the overlay, its centre in container px) or null */
	#holdRing = null

	/**
	 * @param {HTMLElement} container scene host element (empty, positioned, touch-action: none)
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 * @param {{mode?:SceneMode, viewOnly?:boolean, shadows?:boolean, grid?:boolean, gridSnap?:boolean,
	 *          callbacks?:Partial<SceneCallbacks>, limits?:{maxText?:number, maxTitle?:number, maxLabel?:number}}} [opts]
	 *   options; mode decides (none = 'edit', an unknown one = 'view': as in M0, anything but
	 *   edit is view-only); viewOnly is the M0 alias and only ever restricts: viewOnly true
	 *   turns 'edit' into 'view' and keeps vote/view (BoardSession passes both, e.g. mode
	 *   'vote' with viewOnly true). vote is view-only until stage 3; grid (M2, R12): the background grid
	 *   is on from mount() on (only true turns it on); gridSnap (M2, R12): drags and resizes snap to the
	 *   shown grid (missing = on; any other value but true turns it off)
	 */
	constructor(container, model, { mode = undefined, viewOnly = undefined, shadows = true, grid = false, gridSnap = true, callbacks = {}, limits = null } = {}) {
		this.#container = container
		this.#model = model
		const m = mode === undefined ? 'edit' : MODES.includes(mode) ? mode : 'view'
		this.#mode = viewOnly === true && m === 'edit' ? 'view' : m
		this.#viewOnly = this.#mode !== 'edit'
		this.#grid = grid === true
		this.#gridSnap = gridSnap === true
		this.#cb = {}
		for (const name of CALLBACKS) {
			this.#cb[name] = typeof callbacks?.[name] === 'function' ? callbacks[name] : null
		}
		const lim = (k) => (Number.isInteger(limits?.[k]) && limits[k] > 0 ? limits[k] : DEFAULT_LIMITS[k])
		this.#limits = { maxText: lim('maxText'), maxTitle: lim('maxTitle'), maxLabel: lim('maxLabel') }
		this.#renderer = new KonvaRenderer(container, model, { shadows })
		this.#xf = new TransformController(model)
		this.#cc = new ConnectController(model)
	}

	/** Stage, layers, overlay, ResizeObserver, input. Builds no node yet. */
	mount() {
		if (this.#mounted || this.#destroyed) return
		this.#mounted = true
		const { w, h } = this.#measure()
		this.#size = { w, h }
		// single keys need a focusable canvas ([C] sets tabindex="0" on .knorke-canvas; keep it when present)
		if (typeof this.#container.hasAttribute === 'function' && !this.#container.hasAttribute('tabindex')) {
			this.#container.setAttribute('tabindex', '0')
		}
		this.#renderer.mount(w, h)
		if (this.#grid) this.#renderer.setGrid(true)
		// remote drag previews: attached connectors route over the preview boxes
		this.#model.setBoxResolver((id) => {
			const off = this.#renderer.previewOffset(id)
			if (!off) return null
			const a = this.#model.abs(id)
			return a ? { x: a.x + off.dx, y: a.y + off.dy, w: a.w, h: a.h, r: a.r } : null
		})
		const overlay = document.createElement('div')
		overlay.className = 'knorke-scene-overlay'
		setStyles(overlay, {
			position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden',
			'pointer-events': 'none', 'z-index': '1', 'user-select': 'none', '-webkit-user-select': 'none',
		})
		this.#container.appendChild(overlay)
		this.#overlay = overlay
		// before the gesture and input controllers: a pointerdown ends a follow glide
		// first (the press then works on the camera shown) and starts 'press'
		this.#listen(this.#container, 'pointerdown', this.#onCanvasDown)
		this.#cursors = new CursorLayer(overlay, { onTakeOver: (id) => this.#takeOverClicked(id) })
		this.#editor = new TextEditor(overlay, {
			onIntent: (i) => this.#editorIntent(i),
			onClose: (id, info) => this.#editorClosed(id, info),
			onInput: () => this.#wake(),
		})
		this.#gestures = new GestureController(this.#container, {
			getCamera: () => this.#camera.get(),
			viewOnly: () => this.#viewOnly,
			claimTouch: (e) => this.#input.claimTouch(e),
			cancelClaim: () => this.#input.cancelTouch(),
			wantsPan: (e) => e.button === 1 ||
				(e.button === 0 && (this.#viewOnly || this.#space || this.#tool === 'hand')),
			ignoreTarget: (e) => this.#isInteractive(e.target),
			onDirect: (cam) => {
				this.#userCameraOnce()
				this.#setCam(cam)
			},
			onDirectStart: () => {
				this.#userCamSent = false
				this.#call('onActivity', { kind: 'gesture', active: true, ids: [] })
			},
			onDirectEnd: () => {
				this.#emitCamera(this.#camera.get(), true)
				this.#call('onActivity', { kind: 'gesture', active: false, ids: [] })
			},
			onGestureStart: (c0) => this.#gestureStart(c0),
			onGestureFrame: (c1) => {
				this.#userCameraOnce()
				this.#live = { ...c1 }
				this.#liveDirty = true
				this.#emitCamera(c1)
				this.#wake()
			},
			onGestureEnd: (c1) => this.#gestureEnd(c1),
			// stage 3: taps and clicks of mode vote, the late start of mouse/pen pans there, glides end first
			onTap: (e) => this.#tap(e),
			deferPan: (e) => (this.#mode === 'vote' && e.button === 0 ? (e.pointerType === 'pen' ? TAP_SLOP_PX : DRAG_THRESHOLD_PX) : 0),
			beforeStart: () => this.#abortGlide(),
			// (R38) a first finger held still on empty canvas: the input controller may take it for a marquee
			longPress: (id, p) => this.#input.claimLongPress(id, p),
			now: () => performance.now(),
		})
		this.#input = new InputController(this.#container, this.#host())
		// after them (window, bubbling): a tap or click is handled before 'press' ends
		this.#listen(window, 'pointerup', this.#onPressUp)
		this.#listen(window, 'pointercancel', this.#onPressUp)
		if (this.#vote !== null) this.#pushVoteBadges()
		this.#camera.set(-w / 2, -h / 2, 1)
		this.#pendingCam = true
		if (typeof ResizeObserver !== 'undefined') {
			this.#resizeObserver = new ResizeObserver(() => {
				this.#resizePending = true
				this.#wake()
			})
			this.#resizeObserver.observe(this.#container)
		}
		this.#applyCursorStyle()
		this.#wake()
	}

	destroy() {
		if (this.#destroyed) return
		if (this.#mounted && this.#editor?.id !== null) {
			// typed text is never lost silently: commit (or discard a noticed editor)
			if (this.#editor.notice !== null) this.#editor.discard()
			else this.#editor.finish()
		}
		this.#destroyed = true
		if (this.#raf) cancelAnimationFrame(this.#raf)
		this.#raf = 0
		const glide = this.#glide
		this.#glide = null
		this.#live = null
		glide?.resolve(false)
		for (const [target, type, fn] of this.#own) target.removeEventListener(type, fn)
		this.#own = []
		this.#press = { ids: new Set(), active: false }
		this.#input?.destroy()
		this.#gestures?.destroy()
		this.#holdSignal(null)
		this.#resizeObserver?.disconnect()
		this.#cursors?.destroy()
		this.#overlay?.remove()
		if (this.#mounted) this.#renderer.destroy()
		this.#drag = null
		this.#xf.end()
		this.#xfSnap = null
		this.#cc.end()
		this.#model.setBoxResolver(null)
		this.#sampler = null
	}

	// ---------------------------------------------------------------- camera

	/** @return {Camera} confirmed camera (unchanged during a CSS gesture) */
	getCamera() {
		return this.#camera.get()
	}

	/**
	 * Sets the camera; applied in the next animation frame. Ends a running gesture first.
	 *
	 * @param {Camera} cam camera
	 */
	setCamera(cam) {
		if (!cam) return
		this.#endGestureNow()
		this.#setCam(cam)
	}

	/**
	 * @param {number} factor scale factor (> 1 zooms in)
	 * @param {Point|null} [anchor] container point that stays fixed (null = centre)
	 */
	zoomBy(factor, anchor = null) {
		this.#endGestureNow()
		const a = anchor ?? { x: this.#size.w / 2, y: this.#size.h / 2 }
		this.#setCam(this.#camera.zoomAt(a.x, a.y, factor))
	}

	/**
	 * Shows a world rectangle (default: everything). An empty board (null)
	 * gets the camera {x: -vw/2, y: -vh/2, scale: 1}.
	 *
	 * @param {{x:number, y:number, w:number, h:number}|null} [rect] world rectangle
	 * @param {number} [padPx] screen padding
	 */
	fit(rect = this.#model.allBounds(), padPx = 48) {
		this.#endGestureNow()
		this.#setCam(this.#camera.fit(rect, this.#size.w, this.#size.h, padPx))
	}

	/**
	 * Camera that shows rect centred with padPx on every side, WITHOUT the
	 * 100 % limit of fit() (SPEC-M1 §6.3; Shift+2, frame list). Does not set it.
	 *
	 * @param {{x:number, y:number, w:number, h:number}} rect world rectangle
	 * @param {number} [padPx] screen padding
	 * @return {Camera}
	 */
	cameraForRect(rect, padPx = 0) {
		const vw = this.#size.w
		const vh = this.#size.h
		if (!rect || !(vw > 0) || !(vh > 0)) return this.#camera.get()
		const aw = Math.max(1, vw - 2 * padPx)
		const ah = Math.max(1, vh - 2 * padPx)
		const sw = rect.w > 0 ? aw / rect.w : Infinity
		const sh = rect.h > 0 ? ah / rect.h : Infinity
		let scale = Math.min(sw, sh)
		if (!Number.isFinite(scale)) scale = this.#camera.get().scale
		scale = clampScale(scale, MIN_SCALE, MAX_SCALE)
		const cx = rect.x + rect.w / 2
		const cy = rect.y + rect.h / 2
		return { x: cx - vw / (2 * scale), y: cy - vh / (2 * scale), scale }
	}

	/**
	 * The world rectangle the CONFIRMED camera shows (SPEC-M1 §6.3; the
	 * session derives the presence v from it, §6.4): origin = camera x/y,
	 * size = container size / scale, with the container size the scene
	 * measured last (at mount and after a resize). It stays at the confirmed
	 * camera during a CSS gesture, like getCamera(). Before mount w and h are 0.
	 *
	 * @return {{x:number, y:number, w:number, h:number}} world units, unrounded ([C] rounds v with q(…, 10))
	 */
	getViewport() {
		const c = this.#camera.get()
		return { x: c.x, y: c.y, w: this.#size.w / c.scale, h: this.#size.h / c.scale }
	}

	/**
	 * Follow step (SPEC-M1 §6.3 "Folgen" (1)–(7), §6.5.6): brings the camera
	 * to cam without onActivity({kind:'gesture'}) and without onUserCamera.
	 * Never rejects. The promise says whether the camera is at cam now; false
	 * never ends following ([C] keeps following and tries again with the next
	 * presence card).
	 *
	 * The glide runs over the CSS path of a gesture (renderer.beginGesture →
	 * gestureFrame(c) per animation frame → endGesture(c1)): Konva stays
	 * untouched, one synchronous draw at the end (an intermediate draw only
	 * where the renderer's gesture rule asks for one: k ∉ [0.5, 2] or a
	 * translation beyond half the viewport). Meanwhile getCamera() and
	 * getViewport() stay at the confirmed camera, stats().liveCamera is the
	 * glide camera and stats().gliding is true. The viewport centre moves
	 * linearly, the scale geometrically (glideCamera); at the end the
	 * confirmed camera is exactly cam (scale clamped).
	 *
	 * (1) ms is taken as given (the FollowController [C] clamps it to the
	 *     observed interval of the presence cards, 300–2000 ms): ms <= 0, a
	 *     non-finite ms and prefers-reduced-motion (the scene checks it at
	 *     every call) jump, true.
	 * (2) A followTo during a glide replaces it: the old promise resolves
	 *     false; the new glide starts at the camera shown now, without an
	 *     intermediate draw (the CSS path stays open). A jump (1) replacing a
	 *     glide ends the CSS path at cam with one draw.
	 * (3) cam equal to the confirmed camera (Euclidean corner distance ×
	 *     confirmed scale < 0.5 px, |Δscale| <= 0.1 % of the confirmed scale,
	 *     after clamping) while no glide runs: nothing is drawn, no onCamera,
	 *     the camera stays, true.
	 * (4) a user camera gesture runs or may start (wheel or touch on the CSS
	 *     path, a finger down below TAP_SLOP_PX, a mouse/pen pan from its
	 *     pointerdown on, also a deferred one of mode vote): nothing happens,
	 *     false; the user's camera wins, nothing jumps under the finger. A
	 *     drag, transform or press on an item does not block it (in mode edit
	 *     the session ends following on those, §6.5.6).
	 * (5) A pointerdown on the canvas, the start of a wheel gesture,
	 *     stopFollow(), setCamera, fit and zoomBy abort a glide: the camera
	 *     shown becomes the confirmed one (one draw, like endGesture, onCamera
	 *     as at a gesture end), the promise resolves false, no onUserCamera;
	 *     the triggering event or facade call then works as usual (on that
	 *     camera). So do the camera keys (+/−, Shift+1/0/2, Tab).
	 * (6) cam not {x, y, scale} with finite numbers and scale > 0, before
	 *     mount and after destroy: nothing happens, false (destroy resolves
	 *     a running glide false). The scale is clamped to MIN_SCALE..MAX_SCALE
	 *     exactly as setCamera clamps it.
	 * (7) onCamera reports as for a gesture: the glide camera at most 10 ×
	 *     per second, the confirmed camera once at the end.
	 *
	 * @param {Camera} cam target camera, e.g. cameraForRect(viewRect, 0)
	 * @param {number} ms glide duration in ms (see (1))
	 * @return {Promise<boolean>} true when the camera is at cam (jumped, glided, or already there); false
	 *   when nothing happened ((4), (6)) or the glide was aborted or replaced ((2), (5))
	 */
	followTo(cam, ms) {
		if (!this.#mounted || this.#destroyed || !isCamera(cam) || this.#userCameraBusy()) {
			return Promise.resolve(false)
		}
		const target = { x: cam.x, y: cam.y, scale: clampScale(cam.scale, MIN_SCALE, MAX_SCALE) }
		const running = this.#glide
		if (running === null && sameCamera(this.#camera.get(), target)) return Promise.resolve(true)
		if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0) || this.#reducedMotion()) {
			// (1) a jump; (2) it replaces a running glide: the CSS path ends at the target
			if (running !== null) this.#finishGlide(target, false)
			else this.#setCam(target)
			return Promise.resolve(true)
		}
		return new Promise((resolve) => {
			const now = performance.now()
			if (running !== null) {
				// (2) the new glide starts at the camera shown now; the CSS path stays open
				running.resolve(false)
				this.#glide = { from: { ...this.#live }, to: target, t0: now, ms, resolve }
			} else {
				this.#beginGlide(target, ms, now, resolve)
			}
			this.#wake()
		})
	}

	/**
	 * Ends a running followTo glide (SPEC-M1 §6.3 "Folgen" (5), (7)): the
	 * camera it shows now becomes the confirmed camera (one draw, like a
	 * gesture end, onCamera as at a gesture end), its promise resolves false,
	 * no onUserCamera. Without a glide, before mount and after destroy it does
	 * nothing (no draw, no callback).
	 */
	stopFollow() {
		if (!this.#mounted || this.#destroyed) return
		this.#abortGlide()
	}

	/**
	 * @param {number} sx container x
	 * @param {number} sy container y
	 * @return {Point} world point (confirmed camera)
	 */
	screenToWorld(sx, sy) {
		return this.#camera.screenToWorld(sx, sy)
	}

	/**
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @return {Point} container point (confirmed camera)
	 */
	worldToScreen(wx, wy) {
		return this.#camera.worldToScreen(wx, wy)
	}

	/**
	 * @param {string} id item id
	 * @return {{x:number, y:number, w:number, h:number}|null} axis-aligned screen box in container
	 *   coordinates (a connector: its route box; null while it has no route)
	 */
	itemScreenRect(id) {
		const b = this.#model.boundsOf([id])
		if (!b) return null
		const c = this.#camera.get()
		return { x: (b.x - c.x) * c.scale, y: (b.y - c.y) * c.scale, w: b.w * c.scale, h: b.h * c.scale }
	}

	// ---------------------------------------------------------------- model

	/**
	 * After model.apply: build, rebuild, place and re-cull only what changed.
	 *
	 * @param {import('../model/SceneModel.js').ChangeSummary} summary changes
	 */
	update(summary) {
		if (!this.#mounted || this.#destroyed || !summary) return
		if (this.#xf.active && summary.removed.some((id) => this.#xf.all.has(id))) {
			// a transformed item (or a descendant) is gone: drop the transform, no intent
			this.#abortTransform()
		}
		if (this.#cc.active && summary.removed.some((id) => id === this.#cc.id || id === this.#cc.startItem)) {
			// the re-targeted connector or the start item of a new one is gone: drop the drag, no intent
			this.#abortConnect()
		}
		// what is votable may change with any item (type, parent, removal)
		this.#votableCache.clear()
		this.#renderer.applySummary(summary)
		if (summary.removed.length > 0 && this.#selection.prune(this.#model)) {
			this.#selectionChanged(true)
		} else {
			this.#renderSelection()
		}
		if (this.#drag) {
			this.#drag.top = this.#drag.top.filter((id) => this.#model.has(id))
		}
		const p = this.#pendingOpen
		if (p && this.#model.has(p.id) && !this.#editor.closing) {
			this.#pendingOpen = null
			this.openTextEditor(p.id, { text: p.text, notice: p.notice })
		}
		this.#presenceDirty = this.#presenceDirty || this.#samplesActive
		this.#handlesDirty = true
		this.#wake()
	}

	/** After model.load (resync): all nodes go, everything is culled anew. A running drag or transform is dropped without intent. */
	reset() {
		if (!this.#mounted || this.#destroyed) return
		this.#abortDrag()
		this.#abortTransform()
		this.#abortConnect()
		this.#input.cancel()
		this.#votableCache.clear()
		this.#renderer.reset()
		if (this.#selection.prune(this.#model)) {
			this.#selectionChanged(true)
		} else {
			this.#renderSelection()
		}
		this.#presenceDirty = true
		this.#pendingCam = true
		this.#handlesDirty = true
		this.#wake()
	}

	// ---------------------------------------------------------------- tools, selection, mode

	/**
	 * Tool chosen in the shell, optionally with its options (§6.2 TOOLS:
	 * shape {kind}, connector {route, endCap}); unknown option values are
	 * ignored, missing ones keep their value. No onTool echo.
	 *
	 * @param {Tool} tool tool id
	 * @param {ToolOptions|null} [options] options of that tool
	 */
	setTool(tool, options = null) {
		if (!TOOL_IDS.includes(tool)) return
		if (options && typeof options === 'object' && this.#toolOptions[tool]) {
			for (const [k, v] of Object.entries(options)) {
				if (Object.prototype.hasOwnProperty.call(this.#toolOptions[tool], k) && TOOL_OPTION_ENUMS[k]?.includes(v)) {
					this.#toolOptions[tool][k] = v
				}
			}
		}
		if (tool !== this.#tool) {
			this.#tool = tool
			this.#handlesDirty = true
			this.#applyCursorStyle()
			this.#wake()
		}
	}

	/** @return {Tool} */
	getTool() {
		return this.#tool
	}

	/**
	 * @param {Tool} tool tool id
	 * @return {ToolOptions|null} a copy of the tool's options, null for tools without options
	 */
	getToolOptions(tool) {
		const o = typeof tool === 'string' && Object.prototype.hasOwnProperty.call(this.#toolOptions, tool) ? this.#toolOptions[tool] : null
		return o ? { ...o } : null
	}

	/** @return {string[]} selected ids */
	getSelection() {
		return this.#selection.values()
	}

	/**
	 * Selection set by the shell (no onSelection echo). Unknown ids are dropped.
	 *
	 * @param {string[]} ids item ids
	 */
	setSelection(ids) {
		const next = (Array.isArray(ids) ? ids : []).filter((id) => this.#model.has(id))
		if (this.#selection.set(next) && this.#mounted) {
			this.#renderSelection()
			this.#handlesDirty = true
			this.#wake()
		}
	}

	/**
	 * Mode at runtime (SPEC-M1 §6.3, §6.5.4: role, device, voting session;
	 * gone/revoked/logged_out freeze into view). vote behaves like view until
	 * stage 3. Leaving edit:
	 * - without settle (Esc semantics: role lost, frozen): a drag, transform
	 *   or connect drag ends without an intent (model back); an open editor
	 *   stays open, the session decides about it (notice, text rescue)
	 * - (R13) with settle (a voting session starts while editing): first an
	 *   open editor ends with its final commit ({type:'text', …, final:true}),
	 *   then a drag, transform or connect drag ends like a release
	 *   (onDragPreview([]) → intent → onActivity({active:false})); the switch
	 *   comes after both
	 * The same mode again, or an unknown one, does nothing. (R16) A switch
	 * to edit ends an open press (onActivity({kind:'press', active:false,
	 * ids:[]})), after the switch.
	 *
	 * @param {SceneMode} mode new mode
	 * @param {{settle?:boolean}} [opts] settle: finish open work like a release (§6.3)
	 */
	setMode(mode, { settle = false } = {}) {
		if (!MODES.includes(mode) || mode === this.#mode) return
		if (this.#mode === 'edit' && this.#mounted && !this.#destroyed) {
			if (settle) {
				this.#settle()
			} else {
				this.#input.cancel()
			}
		}
		this.#mode = mode
		this.#viewOnly = mode !== 'edit'
		this.#handlesDirty = true
		this.#applyCursorStyle()
		if (mode === 'edit' && this.#press.active) {
			this.#press.active = false
			this.#call('onActivity', { kind: 'press', active: false, ids: [] })
		}
		this.#wake()
	}

	/** @return {SceneMode} */
	getMode() {
		return this.#mode
	}

	/**
	 * Background grid on or off (M2, SPEC-M1 §1.2 (R12)), in every mode. Only
	 * true turns it on; the same state again does nothing. No onGrid echo. A
	 * running drag or resize snaps to the new state from its next step.
	 *
	 * @param {boolean} on grid shown (drags and resizes snap to it)
	 */
	setGrid(on) {
		const v = on === true
		if (v === this.#grid) return
		this.#grid = v
		if (this.#mounted && !this.#destroyed) this.#renderer.setGrid(v)
	}

	/** @return {boolean} the background grid is on */
	getGrid() {
		return this.#grid
	}

	/**
	 * Snapping to the shown grid on or off (M2, SPEC-M1 §1.2 (R12)); only true
	 * turns it on. Draws nothing and calls back nothing; also before mount()
	 * and after destroy() (the state only). With the grid hidden nothing snaps
	 * to it either way. A running drag or resize follows from its next step.
	 *
	 * @param {boolean} on drags and resizes snap to the shown grid
	 */
	setGridSnap(on) {
		this.#gridSnap = on === true
	}

	/** @return {boolean} drags and resizes snap to the grid while it is shown */
	getGridSnap() {
		return this.#gridSnap
	}

	/**
	 * M0 alias: setMode(v ? 'view' : 'edit') without settle (an open editor stays open).
	 *
	 * @param {boolean} viewOnly true = view, false = edit
	 */
	setViewOnly(viewOnly) {
		this.setMode(viewOnly ? 'view' : 'edit')
	}

	/**
	 * Voting state for mode vote (SPEC-M1 §6.3 SceneVoteState, values R16;
	 * [C] builds it from VoteState, §6.5.5). null clears it.
	 *
	 * Unlike setTool or setMode, which ignore unknown values, a deviation
	 * throws: SceneVoteState is a frozen cross-contract, and ignoring a
	 * broken one would only show as missing badges or votes. The check
	 * follows the typedef and its value rules: votable a function, scope a
	 * string or null, badges a Map from item ids (strings) to {mine: an
	 * integer >= 0, total: an integer >= 0 or null (never undefined)},
	 * markVotable a boolean, color #rrggbb; keys beyond it are ignored. On a
	 * TypeError the previous state stays. The scene keeps a frozen copy
	 * (badges copied entry by entry, votable as given), so a later change to
	 * the caller's Map shows only with the next call. Before mount the state
	 * is kept; after destroy a valid one is ignored.
	 *
	 * The renderer draws from it in every mode (renderer.setVoteBadges, one
	 * node in the uiGroup): own votes on a circle in color with digits in
	 * contrastTextOn(color), totals as a number circle beside it when total
	 * !== null, with markVotable the empty rings on visible votable items
	 * without an own vote (not at LOD 2) and the 2-px outline of the scope
	 * frame; stats().voteState counts what the last frame drew. Only
	 * votable(id) === true counts as votable (S-13); votable is asked on a
	 * click or tap of mode vote and, cached until the next state or model
	 * change, for the rings. An exception from votable counts as false and
	 * is reported once per state.
	 *
	 * @param {SceneVoteState|null} state voting state, null = no voting session
	 * @throws {TypeError} when state is neither null nor a valid SceneVoteState
	 */
	setVoteState(state) {
		const next = state === null ? null : checkVoteState(state)
		if (this.#destroyed) return
		this.#vote = next
		this.#votableCache.clear()
		this.#votableErr = false
		if (this.#mounted) this.#pushVoteBadges()
	}

	/** Hands the vote state to the renderer (badges, the cached votable predicate). */
	#pushVoteBadges() {
		const v = this.#vote
		this.#renderer.setVoteBadges(v === null ? null : { badges: v.badges, votable: this.#votableCached, markVotable: v.markVotable, scope: v.scope, color: v.color })
		this.#wake()
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} SceneVoteState.votable(id) === true now (S-13: anything else is not votable)
	 */
	#votableNow(id) {
		const v = this.#vote
		if (v === null) return false
		try {
			return v.votable(id) === true
		} catch (err) {
			if (!this.#votableErr) {
				this.#votableErr = true
				reportAsync(err)
			}
			return false
		}
	}

	/** votable for the painting: #votableNow, cached until the next vote state or model change. */
	#votableCached = (id) => {
		let v = this.#votableCache.get(id)
		if (v === undefined) {
			v = this.#votableNow(id)
			this.#votableCache.set(id, v)
		}
		return v
	}

	/**
	 * (R13) Before a settled mode switch: the open editor ends with its final
	 * commit (an editor with a notice closes without one, as always; the
	 * focus goes back to the canvas when the editor had it), then the running
	 * drag, transform or connect drag ends like a release.
	 */
	#settle() {
		const ed = this.#editor
		if (ed !== null && ed.id !== null && !ed.closing) {
			const el = ed.element
			const focused = !!el && typeof document !== 'undefined' && document.activeElement === el
			ed.finish({ byKey: focused })
		}
		this.#input.settle()
	}

	/** Puts the keyboard focus on the canvas (single keys work again, §6.5.1). */
	focusCanvas() {
		if (!this.#mounted || this.#destroyed) return
		try {
			this.#container.focus?.({ preventScroll: true })
		} catch {
			// focus can fail in a detached document
		}
	}

	/**
	 * Debug/E2E (§6.3, __knorke.handles()): the transformer handles shown now.
	 *
	 * @return {Array<{name:string, x:number, y:number}>} handle centres in container coordinates
	 */
	handles() {
		if (!this.#mounted || this.#destroyed) return []
		if (this.#handlesDirty) {
			this.#syncHandles()
			this.#wake()
		}
		const st = this.#handleState
		if (!st) return []
		const c = this.#camera.get()
		return st.list.map((h) => ({ name: h.name, x: (h.x - c.x) * c.scale, y: (h.y - c.y) * c.scale }))
	}

	/**
	 * Height of a text item for a target state (rule 13): a detached Konva
	 * text measures it, never per frame.
	 *
	 * @param {object} item WireItem (target state: w, style.fontSize, data.text)
	 * @return {number} height in world units
	 */
	measureTextHeight(item) {
		const h = this.#renderer.measureTextHeight(item)
		return typeof h === 'number' && Number.isFinite(h) ? h : (Number.isFinite(item?.h) ? item.h : 0)
	}

	// ---------------------------------------------------------------- presence

	/**
	 * @param {((nowMs:number) => RemoteSample[])|null} fn sampler, asked every frame while it returns samples
	 */
	setRemoteSampler(fn) {
		this.#sampler = typeof fn === 'function' ? fn : null
		this.#presenceDirty = true
		if (!this.#sampler && this.#mounted) {
			this.#lastSamples = []
			this.#samplesActive = false
			this.#renderPresence(performance.now())
		}
		this.#wake()
	}

	/** New presence arrived: wake the loop (cursors on a quiet scene). */
	presenceChanged() {
		this.#presenceDirty = true
		this.#wake()
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} true while dragged or transformed locally (with descendants and attached
	 *   connectors), while its end is dragged (connector), or in the text editor
	 */
	isActive(id) {
		return (this.#drag !== null && this.#drag.all.has(id)) || this.#xf.all.has(id) || this.#xfLinks.has(id) ||
			(this.#cc.active && this.#cc.id === id) || (this.#editor !== null && this.#editor.id === id)
	}

	// ---------------------------------------------------------------- text editor

	/**
	 * Opens the text editor. Without `text` the lease lock applies (another
	 * participant holds the text → chip with "Take over" instead). With `text`
	 * (text rescue) it always opens, with that text instead of the model value.
	 * Called while the editor is closing (from inside its final intent), the
	 * editor opens right after the close.
	 *
	 * @param {string} id item id
	 * @param {{text?:(string|null), notice?:(string|null)}} [opts] start text, notice
	 * @return {boolean} true when the editor is open (or opens after the close) for id
	 */
	openTextEditor(id, { text = null, notice = null } = {}) {
		if (!this.#mounted || this.#destroyed) return false
		const it = this.#model.get(id)
		if (!it || this.#editor.closing) {
			if (text === null || it) {
				this.#pendingOpen = { id, text, notice, until: performance.now() + PENDING_OPEN_MS }
				this.#wake()
			}
			return !!it
		}
		if (!textPathOf(it.t)) return false
		// a locked item opens no user editor (M2, R20); the rescue editor (notice) still does
		if (text === null && notice === null && isLocked(it)) return false
		if (text === null) {
			if (this.#viewOnly && notice === null) return false
			if (this.#editor.id !== id && this.#leaseHeldByOther(id)) {
				this.#offerTakeOver(id)
				return false
			}
		}
		return this.#openEditor(id, { text, notice, takeover: false })
	}

	/**
	 * Lease lost or text rejected: show the notice, stop intermediate commits;
	 * closing then discards without an intent. null removes the notice.
	 *
	 * @param {string} id item id
	 * @param {string|null} notice text (from the session)
	 */
	setEditorNotice(id, notice) {
		if (!this.#mounted || this.#editor.id !== id) return
		this.#editor.setNotice(notice)
		this.#layoutEditor(true)
		this.#wake()
	}

	/**
	 * (R4, T5) Page hide, reload, close or leaving the board: a reload or close
	 * by keyboard fires no blur, so the text typed since the last 1 Hz commit
	 * would be lost. An open editor without a notice whose text differs from
	 * the last value it reported cancels its 1 Hz timer and reports the current
	 * text SYNCHRONOUSLY as an intermediate intent ({type:'text', …,
	 * final:false}, the same path as the 1 Hz commit). Never closes the editor,
	 * never moves the focus, never touches an editor with a notice.
	 *
	 * @return {boolean} true when an intent was emitted; false otherwise (no
	 *   editor, notice shown, nothing new since the last report)
	 */
	flushEditor() {
		if (!this.#mounted || this.#destroyed || this.#editor === null) return false
		return this.#editor.flush()
	}

	// ---------------------------------------------------------------- stats

	/**
	 * voteState (SPEC-M1 §6.3, §6.7 __knorke.scene().voteState, R16): null
	 * without a SceneVoteState, else {scope, markVotable, rings, badges,
	 * totals, outline}, counted from what is DRAWN as of the last frame:
	 * rings = empty rings on visible votable items without an own vote
	 * (always 0 at LOD 2), badges = drawn badges with an own number, totals =
	 * drawn total circles, outline = id of the outlined scope frame or null.
	 * "Visible" is the renderer's culled set (its cull rectangle: the stage
	 * with its overscan, per side at least CULL_MARGIN of the viewport; the
	 * items it draws nodes for); before the first frame with the state the
	 * counters are those of the last frame (0, 0, 0, null without one).
	 * gliding: a followTo glide runs; pressing: 'press' is active.
	 * snapGuides (M2, R12): the number of snap guides the scene last handed
	 * to the renderer for a drag or a resize (0, 1 or 2; 0 without either
	 * and before mount).
	 * gapMarkers (M2, R12, equal gaps): the number of gap markers the scene
	 * last handed to the renderer (0 without a drag, before mount and after
	 * destroy).
	 * grid (M2, R12): the background grid is on (getGrid; also before mount
	 * and after destroy); gridSnap: drags and resizes snap to the shown grid
	 * (getGridSnap; also before mount and after destroy); draws.grid: the grid
	 * paintings since mount (0 before mount and after destroy). snapGuides and
	 * gapMarkers count the snapping to items only. locks (M2, R20): the lock
	 * symbols the last painting drew (0 before mount and after destroy).
	 * holdRing (R38): {x, y}, the centre of the hold ring in container px,
	 * while it shows; null otherwise (also before mount and after destroy).
	 * overscan (M2, SPEC-M1 §6.3 "Überstand"): the renderer's {l, r, t, b,
	 * stageW, stageH} (CSS px: the stage's margin per side and its size);
	 * null before mount, after destroy and when the renderer reports none.
	 *
	 * @return {object} {items, nodesBuilt, attached, staticChildren, activeChildren, uiChildren, lod,
	 *   camera, liveCamera, lastCameraMs, gestureActive, cssTransform, draws:{static, overlay, grid}, transforming,
	 *   handles, voteState:({scope:(string|null), markVotable:boolean, rings:number, badges:number, totals:number,
	 *   outline:(string|null)}|null), snapGuides:number, gapMarkers:number, grid:boolean, gridSnap:boolean,
	 *   holdRing:({x:number, y:number}|null), overscan:({l:number, r:number, t:number, b:number, stageW:number,
	 *   stageH:number}|null), …}
	 */
	stats() {
		const camera = this.#camera.get()
		const base = {
			items: this.#model.size,
			camera,
			liveCamera: this.#live ? { ...this.#live } : camera,
			lastCameraMs: this.#lastCameraMs,
			gestureActive: this.#live !== null,
			tool: this.#tool,
			mode: this.#mode,
			viewOnly: this.#viewOnly,
			loopRunning: this.#raf !== 0,
			editing: this.#editor ? this.#editor.id : null,
			dragging: this.#drag !== null,
			transforming: this.#xf.active,
			transformLive: this.#xf.active ? this.#xf.live : null,
			connecting: this.#cc.mode,
			voteState: this.#vote ? { scope: this.#vote.scope, markVotable: this.#vote.markVotable, ...this.#drawnVotes() } : null,
			gliding: this.#glide !== null,
			pressing: this.#press.active,
			snapGuides: this.#drag !== null ? this.#drag.guides.length : (this.#xfSnap !== null ? this.#xfSnap.guides.length : 0),
			gapMarkers: this.#drag !== null ? this.#drag.gaps.length : 0,
			grid: this.#grid,
			gridSnap: this.#gridSnap,
			holdRing: this.#holdRing !== null ? { x: this.#holdRing.x, y: this.#holdRing.y } : null,
		}
		if (!this.#mounted || this.#destroyed) {
			return {
				...base, nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0,
				visible: 0, cssTransform: null, draws: { static: 0, overlay: 0, grid: 0 }, cursors: 0, handles: 0, locks: 0, groupOutlines: 0,
				overscan: null,
			}
		}
		const r = this.#renderer.stats()
		return {
			...base,
			nodesBuilt: r.nodesBuilt,
			attached: r.attached,
			staticChildren: r.staticChildren,
			activeChildren: r.activeChildren,
			uiChildren: r.uiChildren,
			lod: r.lod,
			visible: r.visible,
			cssTransform: this.#renderer.cssTransform,
			draws: r.draws,
			cursors: this.#cursors.cursorCount,
			handles: this.#handleState ? this.#handleState.list.length : 0,
			locks: r.locks ?? 0,
			groupOutlines: r.groupOutlines ?? 0,
			overscan: r.overscan ? { ...r.overscan } : null,
		}
	}

	/** @return {{rings:number, badges:number, totals:number, outline:(string|null)}} what the last frame drew */
	#drawnVotes() {
		const d = this.#mounted && !this.#destroyed ? this.#renderer.voteDrawn() : null
		if (d === null || typeof d !== 'object') return { ...VOTE_DRAWN_NONE }
		return { rings: d.rings, badges: d.badges, totals: d.totals, outline: d.outline }
	}

	/** @return {KonvaRenderer} renderer (scene lab and debugging only) */
	get renderer() {
		return this.#renderer
	}

	// ---------------------------------------------------------------- internals: loop

	#wake() {
		if (!this.#raf && this.#mounted && !this.#destroyed) {
			this.#raf = requestAnimationFrame(this.#frame)
		}
	}

	#frame = () => {
		this.#raf = 0
		if (this.#destroyed) return
		const now = performance.now()
		if (this.#resizePending) {
			this.#resizePending = false
			const { w, h } = this.#measure()
			if (w !== this.#size.w || h !== this.#size.h) {
				this.#size = { w, h }
				this.#renderer.resize(w, h)
			}
		}
		if (this.#glide !== null) {
			this.#glideStep(now)
		}
		if (this.#live) {
			if (this.#liveDirty) {
				this.#liveDirty = false
				this.#renderer.gestureFrame(this.#live)
			}
		} else if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		if (this.#drag !== null && this.#drag.pending) {
			this.#dragStep()
		}
		if (this.#xfTarget !== null) {
			this.#transformStep()
		}
		if (this.#ccTarget !== null) {
			this.#connectStep()
		}
		if (this.#pendingOpen && now > this.#pendingOpen.until) {
			this.#pendingOpen = null
		}
		if (this.#takeOver && now >= this.#takeOver.until) {
			this.#takeOver = null
			this.#presenceDirty = true
		}
		if (this.#handlesDirty && !this.#live) {
			this.#syncHandles()
		}
		this.#samplePresence(now)
		this.#layoutEditor()
		if (!this.#live) {
			this.#renderer.flushDraws()
		}
		if (this.#camPending && now - this.#camLast >= CAMERA_EMIT_MS) {
			this.#emitCamera(this.#camPending, true)
		}
		if (this.#needsFrame()) {
			this.#wake()
		}
	}

	#needsFrame() {
		return this.#pendingCam || this.#resizePending || this.#presenceDirty || this.#samplesActive || this.#glide !== null ||
			(this.#live !== null && this.#liveDirty) || (this.#drag !== null && this.#drag.pending) ||
			this.#xfTarget !== null || this.#ccTarget !== null || (this.#handlesDirty && this.#live === null) ||
			(this.#live === null && this.#renderer.hasDirty()) || this.#camPending !== null ||
			this.#takeOver !== null || this.#pendingOpen !== null
	}

	#measure() {
		return { w: this.#container.clientWidth || 0, h: this.#container.clientHeight || 0 }
	}

	// ---------------------------------------------------------------- internals: camera

	/** @param {Camera} cam new confirmed camera, applied in the next frame */
	#setCam(cam) {
		const c = this.#camera.set(cam.x, cam.y, cam.scale)
		this.#pendingCam = true
		this.#emitCamera(c)
		this.#wake()
	}

	#applyCameraNow() {
		this.#pendingCam = false
		const c = this.#camera.get()
		const t0 = performance.now()
		this.#renderer.setCamera(c.x, c.y, c.scale)
		this.#lastCameraMs = performance.now() - t0
		this.#presenceDirty = this.#presenceDirty || this.#samplesActive
		// handles follow the scale, and the end and "+" handles appear or go with LOD 2
		if ((this.#handleState && this.#handleState.scale !== c.scale) || this.#coarseAt(c.scale) !== this.#handleCoarse) this.#syncHandles()
	}

	/** A running gesture ends now (commit), a follow glide ends at the camera it shows (§6.3 "Folgen" (5)). */
	#endGestureNow() {
		if (this.#glide !== null) {
			this.#abortGlide()
		} else if (this.#live !== null) {
			this.#gestures.cancel()
		}
	}

	/**
	 * @return {boolean} a user camera gesture runs or may start: CSS path (wheel, touch), a finger
	 *   below the tap threshold, a mouse/pen pan (also a deferred one); a follow glide is none
	 */
	#userCameraBusy() {
		return (this.#live !== null && this.#glide === null) || this.#gestures?.active === true ||
			this.#gestures?.panning === true || this.#gestures?.pending === true
	}

	/** @return {boolean} the user asks for reduced motion (checked at every followTo) */
	#reducedMotion() {
		try {
			return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
				window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true
		} catch {
			return false
		}
	}

	/**
	 * A follow glide starts from the confirmed camera: the canvas is brought
	 * up to date first (as at a gesture start), then the CSS path opens.
	 *
	 * @param {Camera} target clamped target camera
	 * @param {number} ms duration
	 * @param {number} now start time
	 * @param {(ok:boolean) => void} resolve settles the followTo promise
	 */
	#beginGlide(target, ms, now, resolve) {
		if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		this.#renderer.flushDraws()
		const c0 = this.#camera.get()
		this.#live = { ...c0 }
		this.#liveDirty = false
		this.#renderer.beginGesture()
		this.#glide = { from: c0, to: target, t0: now, ms, resolve }
	}

	/** @param {number} now frame time: the glide camera of this frame, or the end */
	#glideStep(now) {
		const g = this.#glide
		const u = (now - g.t0) / g.ms
		if (u >= 1) {
			this.#finishGlide(g.to, true)
			return
		}
		const c = glideCamera(g.from, g.to, u, this.#size.w, this.#size.h)
		this.#live = c
		this.#liveDirty = true
		this.#emitCamera(c)
	}

	/**
	 * The glide ends at cam: it becomes the confirmed camera, drawn once
	 * synchronously (endGesture), onCamera with it; the promise gets result.
	 *
	 * @param {Camera} cam camera
	 * @param {boolean} result true = arrived, false = aborted or replaced by a jump
	 */
	#finishGlide(cam, result) {
		const g = this.#glide
		this.#glide = null
		const c = this.#camera.set(cam.x, cam.y, cam.scale)
		this.#live = null
		this.#liveDirty = false
		this.#pendingCam = false
		this.#syncHandles(c.scale)
		this.#renderer.endGesture(c)
		this.#renderPresence(performance.now())
		this.#layoutEditor(true)
		this.#emitCamera(c, true)
		g.resolve(result)
		this.#wake()
	}

	/** (5) A running glide ends at the camera it shows now, its promise resolves false. */
	#abortGlide() {
		if (this.#glide !== null) this.#finishGlide(this.#live ?? this.#camera.get(), false)
	}

	/** onUserCamera at most once per gesture or pan (its first camera change). */
	#userCameraOnce() {
		if (this.#userCamSent) return
		this.#userCamSent = true
		this.#call('onUserCamera')
	}

	/**
	 * Camera keys (SPEC-M1 §6.10): user camera changes, reported with onUserCamera.
	 *
	 * @param {'in'|'out'|'fit'|'100'|'selection'} what key action
	 */
	#keyCamera(what) {
		if (what === 'selection' && !this.#model.boundsOf(this.#selection.values())) return
		// a running gesture or follow glide ends first: the key works on the camera the user sees
		this.#endGestureNow()
		let cam = null
		const c = this.#camera.get()
		const mid = { x: this.#size.w / 2, y: this.#size.h / 2 }
		if (what === 'in') cam = this.#camera.zoomAt(mid.x, mid.y, KEY_ZOOM_STEP)
		else if (what === 'out') cam = this.#camera.zoomAt(mid.x, mid.y, 1 / KEY_ZOOM_STEP)
		else if (what === '100') cam = this.#camera.zoomAt(mid.x, mid.y, 1 / c.scale)
		else if (what === 'fit') cam = this.#camera.fit(this.#model.allBounds(), this.#size.w, this.#size.h, 48)
		else if (what === 'selection') {
			const rect = this.#model.boundsOf(this.#selection.values())
			if (!rect) return
			cam = this.cameraForRect(rect, SELECTION_ZOOM_PAD_PX)
		}
		if (!cam) return
		this.#call('onUserCamera')
		this.#setCam(cam)
	}

	/** @param {Camera} c0 camera at the start of the gesture */
	#gestureStart(c0) {
		// The CSS transform starts from what the canvas shows: bring it up to date first.
		if (this.#pendingCam) {
			this.#applyCameraNow()
		}
		this.#renderer.flushDraws()
		this.#userCamSent = false
		this.#live = { ...c0 }
		this.#liveDirty = false
		this.#renderer.beginGesture()
		this.#call('onActivity', { kind: 'gesture', active: true, ids: [] })
		this.#wake()
	}

	/** @param {Camera} c1 final camera of the gesture */
	#gestureEnd(c1) {
		const c = this.#camera.set(c1.x, c1.y, c1.scale)
		this.#live = null
		this.#liveDirty = false
		// handles take their screen size for the new scale before the synchronous draw
		this.#syncHandles(c.scale)
		// one synchronous draw of every non-empty layer, transform reset in the same task
		this.#renderer.endGesture(c)
		this.#renderPresence(performance.now())
		this.#layoutEditor(true)
		this.#emitCamera(c, true)
		this.#call('onActivity', { kind: 'gesture', active: false, ids: [] })
		this.#wake()
	}

	/** @return {Camera} the camera the user sees right now (live during a gesture) */
	#liveCam() {
		return this.#live ? this.#live : this.#camera.get()
	}

	/**
	 * @param {Camera} cam camera to report
	 * @param {boolean} [force] ignore the 10 Hz limit
	 */
	#emitCamera(cam, force = false) {
		const now = performance.now()
		if (force || now - this.#camLast >= CAMERA_EMIT_MS) {
			this.#camLast = now
			this.#camPending = null
			this.#call('onCamera', { x: cam.x, y: cam.y, scale: cam.scale })
		} else {
			this.#camPending = { x: cam.x, y: cam.y, scale: cam.scale }
			this.#wake()
		}
	}

	#applyCursorStyle() {
		if (!this.#mounted || this.#destroyed) return
		let cursor = 'default'
		if (this.#viewOnly || this.#space || this.#tool === 'hand') cursor = 'grab'
		else if (CREATE_TOOLS.has(this.#tool)) cursor = 'crosshair'
		else if (this.#hoverHandle !== null) {
			const f = this.#handleState?.frame
			cursor = ANCHORS.includes(this.#hoverHandle) ? getCursor(this.#hoverHandle, f ? f.r || 0 : 0) : 'crosshair'
		}
		this.#renderer.contentEl.style.cursor = cursor
	}

	// ---------------------------------------------------------------- internals: input host

	#host() {
		return {
			model: this.#model,
			gestures: this.#gestures,
			selection: this.#selection,
			viewOnly: () => this.#viewOnly,
			coarse: () => this.#coarseNow(),
			coarseTitleAt: (w, tolWorld) => (this.#coarseNow() ? this.#renderer.coarseTitleAt(w.x, w.y, tolWorld) ?? null : null),
			tool: () => this.#tool,
			toolOptions: (t) => this.getToolOptions(t) ?? {},
			setToolFromScene: (t) => {
				if (TOOL_IDS.includes(t) && t !== this.#tool) {
					this.#tool = t
					this.#handlesDirty = true
					this.#applyCursorStyle()
					this.#call('onTool', t)
					this.#wake()
				}
			},
			// the key G (M2, R12): the scene's own switch, reported like a tool key
			toggleGrid: () => {
				this.setGrid(!this.#grid)
				this.#call('onGrid', this.#grid)
			},
			setSpace: (on) => {
				if (on !== this.#space) {
					this.#space = on
					this.#applyCursorStyle()
				}
			},
			scale: () => this.#liveCam().scale,
			local: (e) => {
				const r = this.#container.getBoundingClientRect()
				return { x: e.clientX - r.left, y: e.clientY - r.top }
			},
			toWorld: (p) => {
				const c = this.#liveCam()
				return { x: c.x + p.x / c.scale, y: c.y + p.y / c.scale }
			},
			canvasFocused: (e) => e?.target === this.#container,
			focusCanvas: () => this.focusCanvas(),
			selectionChanged: () => this.#selectionChanged(true),
			intent: (i) => this.#call('onIntent', i),
			pointer: (w) => this.#call('onPointer', w),
			beginDrag: (ids, primary) => this.#beginDrag(ids, primary),
			// mods.ctrl: Ctrl/⌘ held, the drag does not snap (R12)
			moveDrag: (dx, dy, mods) => {
				if (this.#drag) {
					this.#drag.tx = dx
					this.#drag.ty = dy
					this.#drag.ctrl = !!mods?.ctrl
					this.#drag.pending = true
					this.#wake()
				}
			},
			endDrag: (commit) => this.#endDrag(commit),
			handleAt: (sp, coarse) => this.#handleAt(sp, coarse),
			setHoverHandle: (name) => {
				this.#hoverHandle = name
				this.#applyCursorStyle()
			},
			beginTransform: (anchor, w) => this.#beginTransform(anchor, w),
			// mods.ctrl: Ctrl/⌘ held, the resize does not snap (R12)
			moveTransform: (w, mods) => {
				if (this.#xf.active) {
					this.#xfTarget = { p: { x: w.x, y: w.y }, mods: { shift: !!mods?.shift, alt: !!mods?.alt, ctrl: !!mods?.ctrl } }
					this.#wake()
				}
			},
			endTransform: (commit) => this.#endTransform(commit),
			beginConnect: (w, mods) => this.#beginConnect(w, mods),
			beginConnectHandle: (name, w) => this.#beginConnectHandle(name, w),
			moveConnect: (w, mods) => {
				if (this.#cc.active) {
					this.#ccTarget = { w: { x: w.x, y: w.y }, mods: { ctrl: !!mods?.ctrl, coarse: !!mods?.coarse } }
					this.#wake()
				}
			},
			endConnect: (commit) => this.#endConnect(commit),
			setMarquee: (rect, kind) => {
				this.#renderer.setMarquee(rect, kind)
				this.#wake()
			},
			// (R38) the hold signal of the touch marquee at sp (container px), null hides the ring
			holdSignal: (sp) => this.#holdSignal(sp),
			finishEditor: () => this.#editor.finish(),
			editFromUser: (id) => this.openTextEditor(id),
			userCamera: (what) => this.#keyCamera(what),
			nudge: (dx, dy) => this.#nudge(dx, dy),
			tabSelect: (dir) => this.#tabSelect(dir),
			isInteractiveTarget: (e) => this.#isInteractive(e.target),
			editorOpen: () => this.#editor !== null && this.#editor.id !== null,
			menuReady: () => this.#menuReady(),
			menuAnchor: (ids) => this.#menuAnchor(ids),
		}
	}

	// ---------------------------------------------------------------- internals: context menu (step 4.2)

	/**
	 * Before an intent contextMenu (SPEC-M1 §9.5 WP-S4, step 4.2): no menu
	 * while a camera gesture of the user runs or may start (touch gesture,
	 * mouse/pen pan, a finger below the tap threshold). A wheel gesture or a
	 * follow glide ends first, as at a pointerdown or a camera key: the
	 * camera shown becomes the confirmed one (followTo resolves false, no
	 * onUserCamera), so hit, at and itemScreenRect agree with the picture.
	 *
	 * @return {boolean} true when the menu may open now
	 */
	#menuReady() {
		const g = this.#gestures
		if (g.mode === 'touch' || g.panning || g.pending) return false
		this.#endGestureNow()
		return true
	}

	/**
	 * Keyboard anchor of the context menu (step 4.2): the midpoint of the
	 * selection's axis-aligned screen box (model.boundsOf, confirmed camera,
	 * container px) after clamping its corners into the container, i.e. per
	 * axis the middle of its visible part, or the nearest edge when it lies
	 * outside on that axis; the container centre without a selection (or
	 * without bounds).
	 *
	 * @param {string[]} ids selection
	 * @return {[number, number]} at, container px
	 */
	#menuAnchor(ids) {
		const { w, h } = this.#size
		const b = ids.length > 0 ? this.#model.boundsOf(ids) : null
		if (!b) return [w / 2, h / 2]
		const c = this.#camera.get()
		const x0 = Math.min(w, Math.max(0, (b.x - c.x) * c.scale))
		const x1 = Math.min(w, Math.max(0, (b.x + b.w - c.x) * c.scale))
		const y0 = Math.min(h, Math.max(0, (b.y - c.y) * c.scale))
		const y1 = Math.min(h, Math.max(0, (b.y + b.h - c.y) * c.scale))
		return [(x0 + x1) / 2, (y0 + y1) / 2]
	}

	/**
	 * @param {EventTarget|null} target event target
	 * @return {boolean} true for controls in the overlay (editor, chip buttons)
	 */
	#isInteractive(target) {
		return !!this.#overlay && target !== this.#overlay && target instanceof Node && this.#overlay.contains(target)
	}

	/**
	 * (R38, SPEC-M1 §6.3) The hold signal of the touch marquee: a ring
	 * centred on sp in the overlay (aria-hidden, built anew each time so its
	 * fade-in runs again; place and size inline, the look in knorke.css
	 * .knorke-hold-ring) and one short vibration where the browser can.
	 * null removes the ring at once and vibrates nothing.
	 *
	 * @param {{x:number, y:number}|null} sp container px
	 */
	#holdSignal(sp) {
		this.#holdRing?.el.remove()
		this.#holdRing = null
		if (sp === null || !this.#overlay || this.#destroyed) return
		const el = document.createElement('div')
		el.className = 'knorke-hold-ring'
		el.setAttribute('data-knorke-hold-ring', '')
		el.setAttribute('aria-hidden', 'true')
		setStyles(el, {
			left: `${sp.x - HOLD_RING_PX / 2}px`, top: `${sp.y - HOLD_RING_PX / 2}px`,
			width: `${HOLD_RING_PX}px`, height: `${HOLD_RING_PX}px`,
		})
		this.#overlay.appendChild(el)
		this.#holdRing = { el, x: sp.x, y: sp.y }
		vibrate(LONG_PRESS_VIBRATE_MS)
	}

	#selectionChanged(emit) {
		this.#renderSelection()
		this.#handlesDirty = true
		if (emit) this.#call('onSelection', this.#selection.values())
		this.#wake()
	}

	#renderSelection() {
		if (!this.#mounted || this.#destroyed) return
		// above TRANSFORM_LIVE_MAX the outlines would stay behind the activeGroup preview: hide them meanwhile
		const local = this.#xf.active && !this.#xf.live ? [] : this.#selection.values()
		// one outline per fully selected group instead of its members' own (M2, R20)
		const groups = wholeGroups(this.#model, local).map((g) => this.#model.membersOf(g))
		const grouped = new Set(groups.flat())
		this.#renderer.setSelection(local.filter((id) => !grouped.has(id)), this.#remoteSel, groups)
	}

	// ---------------------------------------------------------------- internals: keys

	/**
	 * Arrow keys (SPEC-M1 §6.3): move intent of the top-level selection by
	 * (dx, dy) world units with origin, marked nudge (the session merges a key
	 * series into one undo step).
	 *
	 * @param {number} dx world delta x
	 * @param {number} dy world delta y
	 */
	#nudge(dx, dy) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return
		// no locked item (M2, R20), no member of a group with a locked member
		const { top } = movedItems(this.#model, movableIds(this.#model, topLevel(this.#selection.values(), this.#model)))
		if (top.length === 0) return
		const origin = new Map()
		for (const id of top) {
			const it = this.#model.get(id)
			origin.set(id, { x: it.x, y: it.y, parent: it.parent })
		}
		this.#call('onIntent', { type: 'move', ids: top, dx, dy, origin, nudge: true })
	}

	/**
	 * Tab / Shift+Tab on the canvas (SPEC-M1 §6.3, WCAG 2.1.1/2.1.2): selects
	 * the next / previous item in reading order and pans it into view. (M2,
	 * R20) Like a click: an item of a group selects its members with the
	 * reached item last; when the current item belongs to a fully selected
	 * group, the step skips that group's other members.
	 *
	 * @param {1|-1} dir direction
	 * @return {boolean} false after the last (before the first) item or without
	 *   items: the key is not handled, Tab leaves the canvas
	 */
	#tabSelect(dir) {
		const model = this.#model
		const ids = [...model.ids()]
		if (ids.length === 0) return false
		const keys = new Map(ids.map((id) => [id, tabKey(model, id)]))
		ids.sort((a, b) => {
			const ka = keys.get(a)
			const kb = keys.get(b)
			for (let i = 0; i < 3; i++) {
				if (ka[i] !== kb[i]) return ka[i] - kb[i]
			}
			return model.compareOrder(a, b)
		})
		const sel = this.#selection.values()
		const curId = sel.length > 0 ? sel[sel.length - 1] : null
		const cur = curId !== null ? ids.indexOf(curId) : -1
		let next = cur < 0 ? (dir > 0 ? 0 : ids.length - 1) : cur + dir
		const g0 = cur < 0 ? null : groupOf(model, curId)
		if (g0 !== null && wholeGroups(model, sel).includes(g0)) {
			const skip = new Set(model.membersOf(g0))
			while (next >= 0 && next < ids.length && skip.has(ids[next])) next += dir
		}
		if (next < 0 || next >= ids.length) return false
		const id = ids[next]
		// like a click: the members of its group first, the reached item last
		this.#selection.set(expandGroups(model, [id]))
		this.#selectionChanged(true)
		this.#panIntoView(id)
		return true
	}

	/**
	 * Centres an item when its box is not fully in the viewport (user camera change).
	 *
	 * @param {string} id item id
	 */
	#panIntoView(id) {
		const r = this.itemScreenRect(id)
		if (!r) return
		if (r.x >= 0 && r.y >= 0 && r.x + r.w <= this.#size.w && r.y + r.h <= this.#size.h) return
		this.#endGestureNow()
		const c = this.#camera.get()
		const a = this.#model.boundsOf([id])
		this.#call('onUserCamera')
		this.#setCam({ x: a.x + a.w / 2 - this.#size.w / (2 * c.scale), y: a.y + a.h / 2 - this.#size.h / (2 * c.scale), scale: c.scale })
	}

	// ---------------------------------------------------------------- internals: drag

	/**
	 * @param {string[]} ids selection
	 * @param {string|null} primary item under the pointer
	 * @return {boolean} true when a drag started
	 */
	#beginDrag(ids, primary) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		// only the movable top-level items move (M2, R20: no locked item, no member of a group
		// with a locked member); their locked descendants follow them
		const { top, all } = movedItems(this.#model, movableIds(this.#model, topLevel(ids, this.#model)))
		if (top.length === 0) return false
		// attached connectors are re-routed in every frame in which the items moved: into the activeGroup with the items (G12)
		for (const c of this.#model.connectorsOf(all)) all.add(c)
		const origin = new Map()
		for (const id of top) {
			const it = this.#model.get(id)
			origin.set(id, { x: it.x, y: it.y, parent: it.parent })
		}
		let lead = primary
		for (let i = 0; lead && !top.includes(lead) && i < 8; i++) {
			lead = this.#model.get(lead)?.parent ?? null
		}
		// the lead (drop target) is a box: a connector has none
		const boxes = top.filter((id) => !isRouted(this.#model, id))
		if (!boxes.includes(lead)) lead = boxes[0] ?? null
		// (M2, R20) a lead in a group: the whole group's union decides when the group is fully
		// dragged (leadGroup = its members), a partly dragged one keeps its parent (false: no target)
		const g = lead !== null ? groupOf(this.#model, lead) : null
		const members = g !== null ? this.#model.membersOf(g) : null
		const dragged = new Set(top)
		const leadGroup = members === null ? null : (members.every((m) => dragged.has(m)) ? members : false)
		// snapping (M2, R12), once per drag: the dragged box (null for connectors only) and
		// the candidates in the live view, without everything that moves (all)
		const box0 = boxes.length > 0 ? this.#model.boundsOf(boxes) : null
		const snap = box0 !== null ? snapIndexOf(this.#model, viewRectOf(this.#liveCam(), this.#size.w, this.#size.h, 0), all) : null
		this.#drag = { top, all, origin, dx: 0, dy: 0, tx: 0, ty: 0, pending: false, lead, leadGroup, box0, snap, ctrl: false, guides: [], gaps: [] }
		this.#renderer.beginDrag(all)
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'drag', active: true, ids: [...all] })
		this.#wake()
		return true
	}

	#dragStep() {
		const d = this.#drag
		d.pending = false
		// the pointer's shift snaps to the candidates (lines and equal gaps), at OBJECT_SNAP_PX of the
		// live scale, and with the grid shown and gridSnap on to it where no item snaps; Ctrl/⌘ drags free
		const s = d.ctrl
			? { dx: d.tx, dy: d.ty, guides: [], gaps: [] }
			: snapMove(d.box0, d.tx, d.ty, d.snap, OBJECT_SNAP_PX / this.#liveCam().scale, this.#grid && this.#gridSnap ? GRID_SIZE : 0)
		const ddx = s.dx - d.dx
		const ddy = s.dy - d.dy
		if (ddx !== 0 || ddy !== 0) {
			const geo = this.#model.moveLocal(d.top, ddx, ddy)
			d.dx = s.dx
			d.dy = s.dy
			this.#renderer.dragMoved(geo)
		}
		this.#showGuides(d, s.guides)
		this.#showGaps(d, s.gaps)
		const preview = []
		for (const id of d.top) {
			// a connector has no position of its own (rule 12): others see its result
			if (isRouted(this.#model, id)) continue
			const a = this.#model.abs(id)
			if (a) preview.push([id, r2(a.x), r2(a.y)])
		}
		this.#call('onDragPreview', preview)
		this.#renderer.setDropTarget(this.#dropTarget(d))
	}

	/**
	 * @param {object} d drag state
	 * @return {string|null} container under the centre of the lead item that accepts it; for a
	 *   lead in a fully dragged group under the centre of the members' union (actions.moveItems'
	 *   rule, M2 R20), none for a lead in a partly dragged group (it keeps its parent)
	 */
	#dropTarget(d) {
		if (d.lead === null || d.leadGroup === false) return null
		const it = this.#model.get(d.lead)
		const a = d.leadGroup ? this.#model.boundsOf(d.leadGroup) : this.#model.abs(d.lead)
		if (!it || !a || typeInfo(it.t).container) return null
		const c = this.#model.topContainerAt(a.x + a.w / 2, a.y + a.h / 2, d.all)
		return c !== null && canBeChildOf(it.t, this.#model.get(c).t) ? c : null
	}

	/**
	 * Hands the snap guides of this frame to the renderer, only when they changed.
	 *
	 * @param {object} d drag state or snap state of a transform (#xfSnap)
	 * @param {import('../model/snap.js').SnapGuide[]} guides guides ([] = none)
	 */
	#showGuides(d, guides) {
		if (sameGuides(d.guides, guides)) return
		d.guides = guides
		this.#renderer.setSnapGuides(guides)
	}

	/**
	 * Hands the gap markers of this frame to the renderer, only when they changed.
	 *
	 * @param {object} d drag state
	 * @param {import('../model/snap.js').GapMarker[]} gaps markers ([] = none)
	 */
	#showGaps(d, gaps) {
		if (sameGuides(d.gaps, gaps)) return
		d.gaps = gaps
		this.#renderer.setGapMarkers(gaps)
	}

	/**
	 * @param {object} d drag state (or snap state of a transform) that ends: its guides go
	 *   (setSnapGuides(null)), then its gap markers (setGapMarkers(null)), each only when there are any
	 */
	#clearGuides(d) {
		if (d.guides.length > 0) {
			d.guides = []
			this.#renderer.setSnapGuides(null)
		}
		if (d.gaps.length > 0) {
			d.gaps = []
			this.#renderer.setGapMarkers(null)
		}
	}

	/** @param {boolean} commit false = Esc (back to the start, no intent) */
	#endDrag(commit) {
		const d = this.#drag
		if (!d) return
		if (commit && d.pending) {
			this.#dragStep()
		}
		const conns = d.top.filter((id) => isRouted(this.#model, id))
		if (!commit) {
			let geo = new Set()
			for (const id of d.top) {
				const it = this.#model.get(id)
				const o = d.origin.get(id)
				if (!it || !o || conns.includes(id)) continue
				geo = new Set([...geo, ...this.#model.moveLocal([id], o.x - it.x, o.y - it.y)])
			}
			// dragged connectors: their free ends go back to the stored ones
			for (const c of this.#model.clearLocal(conns)) geo.add(c)
			this.#renderer.dragMoved(geo)
		}
		this.#clearGuides(d)
		this.#renderer.setDropTarget(null)
		this.#call('onDragPreview', [])
		if (commit && (d.dx !== 0 || d.dy !== 0) && d.top.length > 0) {
			this.#call('onIntent', { type: 'move', ids: d.top.slice(), dx: d.dx, dy: d.dy, origin: new Map(d.origin) })
		}
		this.#drag = null
		this.#renderer.endDrag()
		this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'drag', active: false, ids: [...d.all] })
		// the session applied the connectors' stored state in onActivity; whatever
		// is still local (no op came back) returns to the stored ends
		this.#settleLocal(conns)
		this.#wake()
	}

	/**
	 * Ends the local connector states (shifted free ends, end overrides)
	 * that the session did not replace with a stored state, and redraws them.
	 *
	 * @param {Iterable<string>} ids connectors
	 */
	#settleLocal(ids) {
		const geo = this.#model.clearLocal(ids)
		if (geo.size > 0) this.#renderer.dragMoved(geo)
	}

	/** Drops a drag without moving anything back and without an intent (model was reloaded). */
	#abortDrag() {
		const d = this.#drag
		if (!d) return
		this.#model.clearLocal(d.top.filter((id) => isRouted(this.#model, id)))
		this.#clearGuides(d)
		this.#drag = null
		this.#renderer.setDropTarget(null)
		this.#renderer.endDrag()
		this.#call('onDragPreview', [])
		this.#call('onActivity', { kind: 'drag', active: false, ids: [...d.all] })
	}

	// ---------------------------------------------------------------- internals: transformer

	/**
	 * @param {string[]} ids top-level selected ids
	 * @return {boolean} one of their groups has a locked member (heldGroup, asked once per group)
	 */
	#holdsGroup(ids) {
		const seen = new Set()
		for (const id of ids) {
			const g = groupOf(this.#model, id)
			if (g === null || seen.has(g)) continue
			seen.add(g)
			if (heldGroup(this.#model, g)) return true
		}
		return false
	}

	/**
	 * Handles shown now (world), recomputed for the selection, the tool, the
	 * mode and the camera scale; handed to the renderer (uiGroup).
	 *
	 * @param {number} [scale] camera scale (default: the confirmed camera)
	 */
	#syncHandles(scale = this.#camera.get().scale) {
		this.#handlesDirty = false
		if (!this.#mounted || this.#destroyed) return
		// (R13 (c)) at LOD 2 a connector shows only its halo: no end and no "+" handles
		const coarse = this.#coarseAt(scale)
		this.#handleCoarse = coarse
		let st = null
		const sel = this.#selection.values()
		if (!this.#viewOnly && this.#tool === 'select' && this.#drag === null && this.#editor.id === null && sel.length > 0) {
			const top = this.#xf.active ? this.#xf.ids : topLevel(sel, this.#model)
			const one = top.length === 1 ? top[0] : null
			// a locked top-level item (M2, R20): no transformer and no end handles; with more than
			// one top-level item also an item of a group with a locked member (no resize as a whole)
			const locked = top.some((id) => isLocked(this.#model.get(id))) || (top.length > 1 && this.#holdsGroup(top))
			if (one !== null && isRouted(this.#model, one)) {
				// one connector: its end handles (drag = retarget, §6.3)
				const g = coarse || locked ? null : this.#model.geometryOf(one)
				const list = g ? [{ name: 'start', x: g.start.x, y: g.start.y }, { name: 'end', x: g.end.x, y: g.end.y }] : []
				st = list.length > 0 ? { list, frame: null, scale, outline: null, rotFrom: null, connector: one } : null
			} else if (top.some((id) => !isRouted(this.#model, id))) {
				const frame = this.#xf.active ? this.#xf.frame : selectionFrame(this.#model, top)
				if (frame) {
					const types = new Set(top.filter((id) => !isRouted(this.#model, id)).map((id) => this.#model.get(id)?.t).filter((t) => t !== undefined))
					const list = locked ? [] : handlesFor(frame, types, scale)
					// one note, shape or text item, locked too: the four "+" handles (drag = connect, §6.3)
					if (one !== null && !coarse && !this.#xf.active && !this.#cc.active && isBindable(this.#model.get(one)?.t)) {
						for (const h of plusHandles(this.#model, one, CONNECTOR_PLUS_OFFSET_PX / (scale > 0 ? scale : 1))) {
							list.push({ name: h.name, x: h.x, y: h.y })
						}
					}
					if (list.length > 0 || (frame.n ?? 1) > 1) {
						const r = (frame.r || 0) * Math.PI / 180
						const top0 = { x: frame.x + frame.w / 2 + (frame.h / 2) * Math.sin(r), y: frame.y + frame.h / 2 - (frame.h / 2) * Math.cos(r) }
						// exactly one group (M2, R20): its own outline, no dashed frame of the multi-selection
						const dashed = (frame.n ?? 1) > 1 && !isOneGroup(this.#model, sel)
						st = { list, frame, scale, outline: dashed ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : null, rotFrom: top0, item: one }
					}
				}
			}
		}
		this.#handleState = st
		this.#renderer.setHandles(st ? { handles: st.list, outline: st.outline, rotFrom: st.rotFrom } : null)
		if (this.#hoverHandle !== null && !st?.list.some((h) => h.name === this.#hoverHandle)) {
			this.#hoverHandle = null
			this.#applyCursorStyle()
		}
	}

	/** @return {boolean} the renderer draws LOD 2 now (click and marquee skip connectors, R13 (c)) */
	#coarseNow() {
		return this.#mounted && !this.#destroyed && this.#renderer.lodLevel() === 2
	}

	/**
	 * @param {number} scale camera scale
	 * @return {boolean} a camera with this scale is drawn at LOD 2 (handles are
	 *   placed for the camera about to be applied)
	 */
	#coarseAt(scale) {
		return this.#mounted && !this.#destroyed && this.#renderer.lodAt(scale) === 2
	}

	/**
	 * Screen-space handle test before the model hit test (SPEC-M1 §6.3).
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} coarse touch or pen (HANDLE_TOUCH_PX), else HANDLE_PX
	 * @return {string|null} handle name
	 */
	#handleAt(sp, coarse) {
		if (this.#handlesDirty) {
			this.#syncHandles()
			this.#wake()
		}
		const st = this.#handleState
		if (!st || this.#live) return null
		const c = this.#camera.get()
		const radius = coarse ? HANDLE_TOUCH_PX : HANDLE_PX
		let best = null
		let bestD = Infinity
		for (const h of st.list) {
			const d = Math.hypot((h.x - c.x) * c.scale - sp.x, (h.y - c.y) * c.scale - sp.y)
			if (d <= radius && d < bestD) {
				best = h.name
				bestD = d
			}
		}
		return best
	}

	/**
	 * @param {string} anchor handle name
	 * @param {{x:number, y:number}} w world point where the press started
	 * @return {boolean} true when a transform started
	 */
	#beginTransform(anchor, w) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		if (!ANCHORS.includes(anchor) || !this.#handleState?.list.some((h) => h.name === anchor)) return false
		if (!this.#xf.begin(this.#selection.values(), anchor, w)) return false
		this.#xfTarget = null
		// snapping (M2, R12), once per resize: the candidates in the live view; one item without itself
		// (the children of a resized frame stay and are targets), several without everything that moves
		const exclude = this.#xf.startFrame.n === 1 ? new Set(this.#xf.ids) : this.#xf.all
		const index = anchor === 'rot' ? null : snapIndexOf(this.#model, viewRectOf(this.#liveCam(), this.#size.w, this.#size.h, 0), exclude)
		this.#xfSnap = { index, guides: [], gaps: [] }
		// attached connectors are re-routed while live, scaled with the group above TRANSFORM_LIVE_MAX
		this.#xfLinks = this.#model.connectorsOf(this.#xf.all)
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		this.#renderer.beginDrag(all)
		if (!this.#xf.live) this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'transform', active: true, ids: [...all] })
		this.#wake()
		return true
	}

	/** One transformer step per frame: live (model + nodes) or the activeGroup preview, and the snap guides. */
	#transformStep() {
		const t = this.#xfTarget
		this.#xfTarget = null
		if (!t || !this.#xf.active) return
		// the moving edges snap to the candidates at OBJECT_SNAP_PX of the live scale, and with the grid
		// shown and gridSnap on to it where no item snaps; Ctrl/⌘ resizes free
		const x = this.#xfSnap
		const snap = t.mods.ctrl || x.index === null
			? null
			: { index: x.index, tol: OBJECT_SNAP_PX / this.#liveCam().scale, grid: this.#grid && this.#gridSnap ? GRID_SIZE : 0 }
		const r = this.#xf.step(t.p, { shift: t.mods.shift, alt: t.mods.alt, snap })
		if (!r) return
		if (r.preview) {
			this.#renderer.setActiveTransform(r.preview)
		} else {
			const geo = this.#model.setBoxesLocal(r.map)
			for (const c of this.#model.setEndsLocal(this.#xf.endsMap())) geo.add(c)
			this.#renderer.transformMoved(geo)
		}
		this.#showGuides(x, r.guides)
		this.#syncHandles()
	}

	/** @param {boolean} commit false = Esc (model back, no intent) */
	#endTransform(commit) {
		if (!this.#xf.active) return
		if (commit && this.#xfTarget !== null) {
			this.#transformStep()
		}
		this.#xfTarget = null
		const live = this.#xf.live
		const intent = commit ? this.#xf.result() : null
		const conns = this.#xf.connectors
		if (!live) {
			this.#renderer.setActiveTransform(null)
			if (intent) {
				const geo = this.#model.setBoxesLocal(this.#xf.lastMap())
				for (const c of this.#model.setEndsLocal(this.#xf.endsMap())) geo.add(c)
				this.#renderer.transformMoved(geo)
			}
		} else if (!intent) {
			const geo = this.#model.setBoxesLocal(this.#xf.restoreMap())
			for (const c of this.#model.clearLocal(conns)) geo.add(c)
			this.#renderer.transformMoved(geo)
		}
		this.#clearGuides(this.#xfSnap)
		this.#call('onDragPreview', [])
		if (intent) {
			this.#call('onIntent', intent)
		}
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		this.#xf.end()
		this.#xfSnap = null
		this.#xfLinks = new Set()
		this.#renderer.endDrag()
		this.#renderSelection()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'transform', active: false, ids: [...all] })
		this.#settleLocal(conns)
		this.#wake()
	}

	/** Drops a transform without touching the model and without an intent (reload, item gone). */
	#abortTransform() {
		if (!this.#xf.active) return
		const all = new Set([...this.#xf.all, ...this.#xfLinks])
		const live = this.#xf.live
		this.#model.clearLocal(this.#xf.connectors)
		this.#clearGuides(this.#xfSnap)
		this.#xfSnap = null
		this.#xfLinks = new Set()
		this.#xf.end()
		this.#xfTarget = null
		this.#input?.cancel()
		if (!live) this.#renderer.setActiveTransform(null)
		this.#renderer.endDrag()
		this.#handlesDirty = true
		this.#call('onDragPreview', [])
		this.#call('onActivity', { kind: 'transform', active: false, ids: [...all] })
	}

	// ---------------------------------------------------------------- internals: connectors

	/**
	 * @param {boolean} coarse touch or pen
	 * @return {{snapWorld:number, tolWorld:number}} snapping distance and hit tolerance (world)
	 */
	#snapOpts(coarse) {
		const s = this.#liveCam().scale
		return { snapWorld: SNAP_PX / s, tolWorld: (coarse ? CONNECT_TOL_TOUCH_PX : CONNECT_TOL_PX) / s }
	}

	/**
	 * Connector tool: a drag starts at the press point (snapped like an end).
	 *
	 * @param {{x:number, y:number}} w world point of the press
	 * @param {{ctrl?:boolean, coarse?:boolean}} [mods] Ctrl/⌘ (free), touch or pen
	 * @return {boolean} true when the drag started
	 */
	#beginConnect(w, mods = {}) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		const start = snapAt(this.#model, w, { ...this.#snapOpts(!!mods.coarse), free: !!mods.ctrl })
		if (!this.#cc.beginConnect(start.ep, w)) return false
		this.#ccTarget = null
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: true, ids: [] })
		this.#wake()
		return true
	}

	/**
	 * Drag from a "+" handle (new connector from its anchor) or a connector
	 * end handle (retarget).
	 *
	 * @param {string} name handle name: plus-t/r/b/l, start, end
	 * @param {{x:number, y:number}} w world point of the press
	 * @return {boolean} true when the drag started
	 */
	#beginConnectHandle(name, w) {
		if (this.#viewOnly || this.#drag || this.#xf.active || this.#cc.active) return false
		const st = this.#handleState
		if (!st || !st.list.some((h) => h.name === name)) return false
		if (name === 'start' || name === 'end') {
			const id = st.connector
			if (!id || !this.#cc.beginRetarget(id, name, w)) return false
			this.#renderer.beginDrag([id])
			this.#ccTarget = null
			this.#handlesDirty = true
			this.#call('onActivity', { kind: 'connect', active: true, ids: [id] })
			this.#wake()
			return true
		}
		const item = st.item
		const plus = item ? plusHandles(this.#model, item, 0).find((h) => h.name === name) : null
		if (!plus || !this.#cc.beginConnect({ item, ax: plus.ax, ay: plus.ay }, w)) return false
		this.#ccTarget = null
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: true, ids: [] })
		this.#wake()
		return true
	}

	/** One connect/retarget step per frame: snap, preview, re-route a re-targeted connector. */
	#connectStep() {
		const t = this.#ccTarget
		this.#ccTarget = null
		if (!t || !this.#cc.active) return
		const route = this.#toolOptions.connector.route
		const r = this.#cc.step(t.w, { ...this.#snapOpts(t.mods.coarse), free: t.mods.ctrl, route })
		if (!r) return
		if (this.#cc.mode === 'retarget') {
			const geo = this.#model.setEndsLocal(new Map([[this.#cc.id, { [this.#cc.which]: r.ep }]]))
			this.#renderer.dragMoved(geo)
			this.#handlesDirty = true
		}
		this.#renderer.setConnectPreview({
			points: r.preview ? r.preview.hitPts : [],
			target: r.box,
			anchors: r.anchors.map((a) => ({ x: a.x, y: a.y })),
			snap: r.snap,
		})
	}

	/**
	 * Release (commit) or Esc: preview cleared → intent (connect, or retarget
	 * while the connector is still active) → onActivity(connect, false).
	 *
	 * @param {boolean} commit false = Esc (no intent)
	 */
	#endConnect(commit) {
		if (!this.#cc.active) return
		if (commit && this.#ccTarget !== null) {
			this.#connectStep()
		}
		this.#ccTarget = null
		const mode = this.#cc.mode
		const id = this.#cc.id
		const intent = commit ? this.#cc.result(this.#toolOptions.connector) : null
		this.#renderer.setConnectPreview(null)
		if (mode === 'retarget' && !intent) {
			this.#renderer.dragMoved(this.#model.clearLocal([id]))
		}
		if (intent) {
			this.#call('onIntent', intent)
		}
		this.#cc.end()
		if (mode === 'retarget') this.#renderer.endDrag()
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: false, ids: id ? [id] : [] })
		if (mode === 'retarget') this.#settleLocal([id])
		if (mode === 'connect' && intent && this.#tool === 'connector') {
			this.#tool = 'select'
			this.#applyCursorStyle()
			this.#call('onTool', 'select')
		}
		this.#wake()
	}

	/** Drops a connect/retarget drag without an intent (reload, item gone, view-only). */
	#abortConnect() {
		if (!this.#cc.active) return
		const mode = this.#cc.mode
		const id = this.#cc.id
		this.#cc.end()
		this.#ccTarget = null
		this.#input?.cancel()
		this.#renderer.setConnectPreview(null)
		if (mode === 'retarget') {
			this.#model.clearLocal([id])
			this.#renderer.endDrag()
		}
		this.#handlesDirty = true
		this.#call('onActivity', { kind: 'connect', active: false, ids: id ? [id] : [] })
	}

	// ---------------------------------------------------------------- internals: editor

	/**
	 * @param {string} id item id (exists, has a text path)
	 * @param {{text:(string|null), notice:(string|null), takeover:boolean}} o options
	 * @return {boolean}
	 */
	#openEditor(id, { text, notice, takeover }) {
		const it = this.#model.get(id)
		const path = textPathOf(it.t)
		if (this.#editor.id === id) {
			if (takeover) {
				// "Take over" for the item whose editor is already open (the
				// button outlives the offer until the next frame, e.g. when a text
				// rescue opened this editor with a notice in between): the user
				// explicitly takes the lease. Lift the notice so commits resume and
				// report the take-over; never drop it silently.
				if (this.#takeOver?.id === id) this.#takeOver = null
				this.#editor.setNotice(null)
				this.#call('onEditing', id, true)
				this.#layoutEditor(true)
				this.#presenceDirty = true
				this.#wake()
			} else if (notice !== null) {
				this.#editor.setNotice(notice)
			}
			return true
		}
		if (this.#editor.id !== null) {
			this.#editor.finish()
			if (this.#editor.id !== null) return false
		}
		const cur = getPath(it, path)
		const before = typeof cur === 'string' ? cur : ''
		const kind = typeInfo(it.t).editor ?? 'note'
		if (this.#takeOver?.id === id) this.#takeOver = null
		this.#editorMeasure = null
		this.#editor.open({
			id,
			path,
			kind,
			value: typeof text === 'string' ? text : before,
			before,
			maxLength: path === 'data.title' ? this.#limits.maxTitle : path === 'data.label' ? this.#limits.maxLabel : this.#limits.maxText,
			notice,
		})
		this.#renderer.setTextHidden(id, true)
		this.#handlesDirty = true
		this.#call('onEditing', id, takeover)
		this.#call('onActivity', { kind: 'edit', active: true, ids: [id] })
		this.#layoutEditor(true)
		this.#presenceDirty = true
		this.#wake()
		return true
	}

	/**
	 * Text intents of the editor: a `text` item gets h, its height measured
	 * for the new text (rule 13).
	 *
	 * @param {object} i text intent
	 */
	#editorIntent(i) {
		const it = this.#model.get(i.id)
		if (it && typeInfo(it.t).resize === 'text') {
			i.h = this.#textHeight(it, i.value)
		}
		this.#call('onIntent', i)
	}

	/**
	 * @param {object} it text item
	 * @param {string} value text
	 * @return {number} measured height (cached for the open editor's value)
	 */
	#textHeight(it, value) {
		const m = this.#editorMeasure
		if (m && m.id === it.id && m.value === value && m.w === it.w && m.fs === it.style?.fontSize) return m.h
		const h = this.measureTextHeight({ ...it, data: { ...it.data, text: value } })
		this.#editorMeasure = { id: it.id, value, w: it.w, fs: it.style?.fontSize, h }
		return h
	}

	/**
	 * @param {string} id item whose editor closed
	 * @param {{byKey?:boolean}} [info] ended by a key
	 */
	#editorClosed(id, info) {
		if (this.#destroyed) return
		this.#renderer.setTextHidden(id, false)
		this.#editorMeasure = null
		this.#handlesDirty = true
		this.#call('onEditing', null, false)
		this.#call('onActivity', { kind: 'edit', active: false, ids: [id] })
		const p = this.#pendingOpen
		if (p && this.#model.has(p.id)) {
			// opened from inside the final intent (series entry): now
			this.#pendingOpen = null
			if (info?.byKey) this.focusCanvas()
			this.openTextEditor(p.id, { text: p.text, notice: p.notice })
		} else if (info?.byKey && this.#editor.id === null) {
			this.focusCanvas()
		}
		this.#wake()
	}

	/**
	 * @param {boolean} [force] lay out even when the loop would skip it
	 */
	#layoutEditor(force = false) {
		const id = this.#editor?.id
		if (id === null || id === undefined || (!force && !this.#editor.element)) return
		const it = this.#model.get(id)
		const a = this.#model.abs(id)
		if (!it || !a) return
		const c = this.#liveCam()
		const s = c.scale
		const kind = this.#editor.kind
		if (kind === 'label') {
			// connector label: the estimated label box of the text being typed,
			// centred at labelAt (at least LABEL_EDITOR_MIN_W wide)
			const g = this.#model.geometryOf(id)
			if (!g || !g.labelAt) return
			const b = labelBox(this.#editor.value === '' ? ' ' : this.#editor.value, g.labelAt)
			const w = Math.max(b.w, LABEL_EDITOR_MIN_W)
			this.#editor.layout({
				x: (g.labelAt.x - w / 2 - c.x) * s,
				y: (b.y - c.y) * s,
				w: w * s,
				h: b.h * s,
				r: 0,
				padding: CONNECTOR_LABEL_PAD * s,
				fontSize: CONNECTOR_LABEL_FONT_SIZE * s,
				background: BOARD_BACKGROUND,
				align: 'center',
			})
			return
		}
		if (kind === 'title') {
			this.#editor.layout({
				x: (a.x - c.x) * s,
				y: (a.y - FRAME_TITLE_BAND - c.y) * s,
				w: a.w * s,
				h: FRAME_TITLE_BAND * s,
				r: 0,
				padding: 0,
				fontSize: FRAME_TITLE_SIZE * s,
				background: 'rgba(255,255,255,0.92)',
			})
			return
		}
		if (kind === 'shape') {
			const b = shapeTextBox(it, a, this.#editor.value)
			// the text box rotates with the shape around the shape's centre
			const r = (a.r || 0) * Math.PI / 180
			const ox = b.x + b.w / 2 - a.w / 2
			const oy = b.y + b.h / 2 - a.h / 2
			const cx = a.x + a.w / 2 + ox * Math.cos(r) - oy * Math.sin(r)
			const cy = a.y + a.h / 2 + ox * Math.sin(r) + oy * Math.cos(r)
			this.#editor.layout({
				x: (cx - b.w / 2 - c.x) * s,
				y: (cy - b.h / 2 - c.y) * s,
				w: b.w * s,
				h: b.h * s,
				r: a.r,
				padding: b.pad * s,
				fontSize: b.fontSize * s,
				background: null,
				align: b.align,
				color: b.color,
			})
			return
		}
		if (kind === 'text') {
			const h = Math.max(a.h, this.#textHeight(it, this.#editor.value))
			this.#editor.layout({
				x: (a.x - c.x) * s,
				y: (a.y - c.y) * s,
				w: a.w * s,
				h: h * s,
				r: a.r,
				padding: 0,
				fontSize: fieldValue(it, 'style.fontSize') * s,
				background: null,
				align: fieldValue(it, 'style.align'),
				color: fieldValue(it, 'style.color'),
			})
			return
		}
		const fill = fieldValue(it, 'style.fill')
		this.#editor.layout({
			x: (a.x - c.x) * s,
			y: (a.y - c.y) * s,
			w: a.w * s,
			h: a.h * s,
			r: a.r,
			padding: STICKY_PADDING * s,
			fontSize: noteFontSize({ ...it, data: { ...it.data, text: this.#editor.value } }) * s,
			background: fill,
		})
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} true when another participant holds the text lease (fresh sample)
	 */
	#leaseHeldByOther(id) {
		let samples = this.#lastSamples
		if (this.#sampler) {
			try {
				const fresh = this.#sampler(performance.now())
				if (Array.isArray(fresh)) samples = fresh
			} catch (err) {
				reportAsync(err)
			}
		}
		return samples.some((s) => s && s.editing === id && s.editingHolder === true)
	}

	/** @param {string} id blocked item: its chip offers "Take over" for TAKE_OVER_MS */
	#offerTakeOver(id) {
		this.#takeOver = { id, until: performance.now() + TAKE_OVER_MS }
		this.#presenceDirty = true
		this.#wake()
	}

	/**
	 * Always ends in onEditing(id, true) when the item exists and the scene is
	 * editable, also when this item's editor is already open (see #openEditor).
	 *
	 * @param {string} id item whose "Take over" was clicked
	 */
	#takeOverClicked(id) {
		this.#takeOver = null
		this.#presenceDirty = true
		if (!this.#model.has(id) || this.#viewOnly) {
			this.#wake()
			return
		}
		this.#openEditor(id, { text: null, notice: null, takeover: true })
	}

	// ---------------------------------------------------------------- internals: presence

	/** @param {number} now frame time */
	#samplePresence(now) {
		if (!this.#sampler) {
			this.#presenceDirty = false
			return
		}
		if (!this.#samplesActive && !this.#presenceDirty) return
		this.#presenceDirty = false
		let samples = []
		try {
			const out = this.#sampler(now)
			if (Array.isArray(out)) samples = out
		} catch (err) {
			reportAsync(err)
		}
		this.#lastSamples = samples
		this.#samplesActive = samples.length > 0
		this.#renderPresence(now)
	}

	/** @param {number} now time for the take-over window */
	#renderPresence(now) {
		if (!this.#mounted || this.#destroyed) return
		const cam = this.#liveCam()
		this.#cursors.render(this.#lastSamples, cam, {
			itemAnchor: (id) => this.#anchorOf(id, cam),
			takeOver: this.#takeOver,
			now,
		})
		const remote = []
		const previews = new Map()
		for (const s of this.#lastSamples) {
			if (!s) continue
			if (Array.isArray(s.selection) && s.selection.length > 0) {
				remote.push({ ids: s.selection.filter((id) => typeof id === 'string' && this.#model.has(id)), color: s.color })
			}
			if (Array.isArray(s.drag)) {
				for (const d of s.drag) {
					if (Array.isArray(d) && typeof d[0] === 'string' && !this.isActive(d[0])) {
						previews.set(d[0], { x: d[1], y: d[2] })
					}
				}
			}
		}
		this.#remoteSel = remote
		if (this.#renderer.setPreviews(previews)) {
			// the box resolver answers differently now: route the connectors of
			// the items that are (or were) previewed anew
			const ids = new Set([...this.#previewIds, ...previews.keys()])
			this.#previewIds = new Set(previews.keys())
			const geo = this.#model.reroute(ids)
			if (geo.size > 0) this.#renderer.dragMoved(geo)
		}
		this.#renderSelection()
	}

	/**
	 * @param {string} id item id
	 * @param {Camera} cam camera
	 * @return {{x:number, y:number}|null} screen point above which the chip sits
	 */
	#anchorOf(id, cam) {
		const it = this.#model.get(id)
		const b = it ? this.#model.boundsOf([id]) : null
		if (!b) return null
		// a title editor (frame) sits in the band above the box: the chip goes above that band
		const top = typeInfo(it.t).editor === 'title' ? b.y - FRAME_TITLE_BAND : b.y
		return { x: (b.x - cam.x) * cam.scale, y: (top - cam.y) * cam.scale }
	}

	// ---------------------------------------------------------------- internals: stage 3 (press, vote)

	/**
	 * @param {EventTarget} target element or window
	 * @param {string} type event type
	 * @param {Function} fn listener (removed in destroy)
	 */
	#listen(target, type, fn) {
		target.addEventListener(type, fn)
		this.#own.push([target, type, fn])
	}

	/**
	 * First pointerdown listener of the canvas: a follow glide ends at the
	 * camera shown (§6.3 "Folgen" (5)); in modes vote and view the first
	 * pointer down starts 'press' (R16: per canvas, not per pointer).
	 *
	 * @param {PointerEvent} e pointerdown
	 */
	#onCanvasDown = (e) => {
		this.#abortGlide()
		if (this.#isInteractive(e.target)) return
		const P = this.#press
		P.ids.add(e.pointerId)
		if (this.#mode !== 'edit' && !P.active && P.ids.size === 1) {
			P.active = true
			this.#call('onActivity', { kind: 'press', active: true, ids: [] })
		}
	}

	/**
	 * pointerup/pointercancel anywhere (window, after the canvas listeners):
	 * the last pointer of the canvas up ends 'press'.
	 *
	 * @param {PointerEvent} e pointerup or pointercancel
	 */
	#onPressUp = (e) => {
		const P = this.#press
		if (!P.ids.delete(e.pointerId)) return
		if (P.active && P.ids.size === 0) {
			P.active = false
			this.#call('onActivity', { kind: 'press', active: false, ids: [] })
		}
	}

	/**
	 * A tap (finger, pen) or a click (mouse) that did not become a camera
	 * gesture (GestureController.onTap). Mode vote with a vote state only:
	 * the item hit (same rules as a selection click) gives voteMiss when it
	 * is not votable (votable(id) === true, S-13), else vote {id, rect}
	 * with rect = itemScreenRect(id) now (container px, confirmed camera,
	 * axis-aligned; CLI-18). A finger or pen on a votable item whose screen
	 * box has min(w, h) < SMALL_TARGET_PX zooms instead (user camera change,
	 * onUserCamera), unless the zoom cannot enlarge it any more. Empty canvas:
	 * nothing.
	 *
	 * @param {PointerEvent} e pointerup of the tap or click
	 */
	#tap(e) {
		if (this.#mode !== 'vote' || this.#vote === null || !this.#mounted || this.#destroyed) return
		const r = this.#container.getBoundingClientRect()
		const w = this.screenToWorld(e.clientX - r.left, e.clientY - r.top)
		const id = this.#input.hitAt(w, e.pointerType === 'touch')
		if (id === null) return
		if (!this.#votableNow(id)) {
			this.#call('onIntent', { type: 'voteMiss', id })
			return
		}
		const rect = this.itemScreenRect(id)
		if (rect === null) return
		if ((e.pointerType === 'touch' || e.pointerType === 'pen') && Math.min(rect.w, rect.h) < SMALL_TARGET_PX) {
			const cam = this.#smallTargetCamera(id)
			if (cam !== null) {
				this.#endGestureNow()
				this.#call('onUserCamera')
				this.#setCam(cam)
				return
			}
		}
		this.#call('onIntent', { type: 'vote', id, rect })
	}

	/**
	 * Small-target zoom of mode vote (§6.3, CLI-06): the item centred, its
	 * shorter side SMALL_TARGET_GOAL_PX on screen, but never so big that it
	 * leaves SMALL_TARGET_PAD_PX on any side (the item and its surroundings
	 * stay in view; no 100 % limit).
	 *
	 * @param {string} id item id
	 * @return {Camera|null} null when this camera would not enlarge the item (the tap votes)
	 */
	#smallTargetCamera(id) {
		const b = this.#model.boundsOf([id])
		const side = b ? Math.min(b.w, b.h) : 0
		if (!(side > 0)) return null
		const s = this.#camera.get().scale
		const want = clampScale(Math.min(SMALL_TARGET_GOAL_PX / side, this.cameraForRect(b, SMALL_TARGET_PAD_PX).scale), MIN_SCALE, MAX_SCALE)
		if (!(want > s * (1 + SMALL_TARGET_MIN_GAIN))) return null
		return { x: b.x + b.w / 2 - this.#size.w / (2 * want), y: b.y + b.h / 2 - this.#size.h / (2 * want), scale: want }
	}

	// ---------------------------------------------------------------- internals: callbacks

	/**
	 * @param {string} name callback name
	 * @param {...any} args arguments
	 */
	#call(name, ...args) {
		const fn = this.#cb[name]
		if (fn === null) return
		try {
			fn(...args)
		} catch (err) {
			reportAsync(err)
		}
	}
}
